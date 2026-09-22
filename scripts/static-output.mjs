/**
 * Post-build step: make the build output directly deployable to a static host.
 *
 * Depending on the build environment, the browser files land in dist/client,
 * dist/public, .output/public, or already at the top of dist/. We locate the
 * directory that actually holds index.html, copy it to dist/, add a 404.html
 * SPA fallback, and drop the server-side artifacts so only static files ship.
 */
import { cp, copyFile, readdir, access, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist");

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const candidates = [
  path.join(out, "client"),
  path.join(out, "public"),
  path.join(root, ".output", "public"),
  path.join(root, "build", "client"),
  out,
];

let source = null;
for (const dir of candidates) {
  if (await exists(path.join(dir, "index.html"))) {
    source = dir;
    break;
  }
}

if (!source) {
  console.error("[static-output] no index.html found in: " + candidates.join(", "));
  process.exit(1);
}

if (path.resolve(source) !== path.resolve(out)) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(path.join(source, entry.name), path.join(out, entry.name), {
      recursive: true,
      force: true,
    });
  }
  console.log(`[static-output] copied ${path.relative(root, source)} -> dist/`);
} else {
  console.log("[static-output] index.html already at dist/ root");
}

const index = path.join(out, "index.html");
if (!(await exists(index))) {
  console.error("[static-output] dist/index.html missing after copy.");
  process.exit(1);
}

// Single-route SPA: any unknown path should still boot the app.
await copyFile(index, path.join(out, "404.html"));

// Static host receives static files only — drop server-side build artifacts
// and the now-duplicated nested client directory.
for (const leftover of ["client", "public", "server", "nitro.json", "_server", "_worker.js"]) {
  const target = path.join(out, leftover);
  if (path.resolve(target) === path.resolve(out)) continue;
  await rm(target, { recursive: true, force: true });
}

console.log("[static-output] dist/index.html + assets ready for static hosting");
