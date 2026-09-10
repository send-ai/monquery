import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "mongo/index": "src/mongo/index.ts",
    "express/index": "src/express/index.ts",
    "typegoose/index": "src/typegoose/index.ts",
    "zod/index": "src/zod/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: ["mongodb", "@typegoose/typegoose", "reflect-metadata", "zod"],
});
