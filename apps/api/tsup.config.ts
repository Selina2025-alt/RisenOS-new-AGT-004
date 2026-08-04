import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [
    "@risen/content-contracts",
    "@risen/content-core",
    "@risen/content-adapters",
    "@risen/content-database",
  ],
});
