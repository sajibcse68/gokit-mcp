import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "view",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../dist",
    // false so concurrent `vite build --watch` for the company bundle (see
    // vite.company.config.ts) doesn't get wiped by this one emptying dist/.
    emptyOutDir: false,
    target: "es2020",
  },
});
