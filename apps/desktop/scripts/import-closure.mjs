import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const builtins = new Set(Module.builtinModules);
const VALID_PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const packageNameOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

export const scanImportClosure = (
  rootDir,
  entryPoints,
  skipPackages = new Set(),
) => {
  const seen = new Set();
  const queue = entryPoints.filter((entry) => existsSync(join(rootDir, entry)));
  const packages = new Set();

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(join(rootDir, file))) continue;
    seen.add(file);
    const source = readFileSync(join(rootDir, file), "utf8");
    const specifiers = [
      ...source.matchAll(/from\s*["']([^"'\n]+)["']/g),
      ...source.matchAll(/import\s*["']([^"'\n]+)["']/g),
      ...source.matchAll(/import\(\s*["']([^"'\n]+)["']\s*\)/g),
      ...source.matchAll(/require\(\s*["']([^"'\n]+)["']\s*\)/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = resolve(dirname(join(rootDir, file)), specifier);
        const targetRelative = relative(rootDir, target);
        if (targetRelative.endsWith(".js") && !targetRelative.startsWith(".."))
          queue.push(targetRelative);
        continue;
      }
      if (specifier.startsWith("node:") || specifier.startsWith("bun:"))
        continue;
      const packageName = packageNameOf(specifier);
      if (!VALID_PACKAGE.test(packageName)) continue;
      if (builtins.has(packageName) || skipPackages.has(packageName)) continue;
      packages.add(packageName);
    }
  }

  return { seen, packages };
};
