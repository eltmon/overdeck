import { defineConfig } from "tsdown";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  outExtensions: () => ({ js: ".js" }),
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    deps: {
      alwaysBundle: (id: string) => id.startsWith("@panctl/"),
      neverBundle: ["electron"],
    },
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
    deps: {
      neverBundle: ["electron"],
    },
  },
]);
