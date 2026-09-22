/**
 * Builds the release artifacts for the current commit into release/:
 *
 *   clawdmeter-v<version>-source.zip   what the hosting platform uploads and builds
 *                                      (`npm ci && npm run build`); `git archive` of
 *                                      HEAD, minus the export-ignore paths in .gitattributes
 *   clawdmeter-v<version>-dist.zip     the static build output (run `npm run build` first)
 *   SHA256SUMS.txt
 *
 *   npm run package              build the zips
 *   npm run package -- --verify  also unpack the source zip into a clean folder and
 *                                prove `npm ci && npm run build` works from it alone
 *
 * Dev-time and CI only; nothing here ships. Uses Node built-ins plus git.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const root = process.cwd();
const out = path.join(root, "release");
const { name, version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const base = `${name}-v${version}`;

function fail(message) {
  console.error(`✘ ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await filesUnder(directory, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/**
 * Minimal deterministic zip writer (deflate, UTF-8 names, fixed 1980-01-01 timestamps),
 * so the same dist/ always produces byte-identical output.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name: entryName, data } of entries) {
    const nameBytes = Buffer.from(entryName, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function sourceZip() {
  if (run("git", ["status", "--porcelain", "--untracked-files=no"]).trim()) {
    fail(
      "Uncommitted changes to tracked files. The source zip is built from HEAD, so commit them first.",
    );
  }
  const target = path.join(out, `${base}-source.zip`);
  run("git", ["archive", "--format=zip", `--output=${target}`, "HEAD"]);
  return target;
}

async function distZip() {
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "index.html")))
    fail("dist/index.html is missing. Run `npm run build` first.");
  const files = (await filesUnder(dist)).sort();
  const entries = await Promise.all(
    files.map(async (file) => ({ name: file, data: await readFile(path.join(dist, file)) })),
  );
  const target = path.join(out, `${base}-dist.zip`);
  await writeFile(target, zip(entries));
  return target;
}

/** The platform only ever gets the source zip, so prove it builds with nothing else around it. */
async function verifySource(sourcePath) {
  const scratch = await mkdtemp(path.join(tmpdir(), `${base}-verify-`));
  try {
    run("unzip", ["-q", sourcePath, "-d", scratch]);
    if (existsSync(path.join(scratch, "worker")))
      fail("The source zip contains worker/, which must ship separately.");
    // Windows can only launch npm.cmd through a shell; the arguments here are fixed.
    const npmOptions = {
      cwd: scratch,
      stdio: ["ignore", "ignore", "inherit"],
      shell: process.platform === "win32",
    };
    run("npm", ["ci", "--no-audit", "--no-fund"], npmOptions);
    run("npm", ["run", "build"], npmOptions);
    const built = (await filesUnder(path.join(scratch, "dist"))).sort();
    if (!built.includes("index.html"))
      fail("Building from the source zip produced no dist/index.html.");
    console.log(`✔ Source zip builds on its own (${built.length} files in dist/).`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const artifacts = [await sourceZip(), await distZip()];
const sums = await Promise.all(
  artifacts.map(
    async (file) =>
      `${createHash("sha256")
        .update(await readFile(file))
        .digest("hex")}  ${path.basename(file)}`,
  ),
);
await writeFile(path.join(out, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
for (const line of sums) console.log(line);
if (process.argv.includes("--verify")) await verifySource(artifacts[0]);
