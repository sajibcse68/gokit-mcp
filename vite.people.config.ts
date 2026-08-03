import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// vite-plugin-singlefile only supports one HTML entry per build, so the
// people bundle is built via a separate config into the same dist/ dir
// (see vite.config.ts for the police dashboard bundle and
// vite.company.config.ts for the company-info bundle).
export default defineConfig({
  root: "view",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    target: "es2020",
    rollupOptions: {
      input: path.resolve(__dirname, "view/people.html"),
    },
  },
});
