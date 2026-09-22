import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    // Prerendered at build time to static HTML; no server entry, server
    // functions, or runtime ships (scripts/static-output.mjs drops the
    // server build). Not `spa: { enabled: true }`: that mode hydrates the
    // prerendered shell at the exact route it was built for and throws
    // React #418 there — an open TanStack Router bug (#8473) at our
    // versions, with no workaround for the single-route case.
    tanstackStart({
      pages: [{ path: "/" }],
      prerender: { enabled: true, autoStaticPathsDiscovery: false },
    }),
    viteReact(),
  ],
});
