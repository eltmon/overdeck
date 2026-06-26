import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageResolutionRoots = [
  __dirname,
  path.resolve(__dirname, '../../..'),
  path.resolve(__dirname, '../../../node_modules/.bun/node_modules'),
  path.resolve(__dirname, '../../../../..'),
  path.resolve(__dirname, '../../../../../node_modules/.bun/node_modules'),
];

function resolvePackage(specifier: string): string {
  return require.resolve(specifier, { paths: packageResolutionRoots });
}

function resolvePackageDir(specifier: string): string {
  if (specifier === '@overdeck/contracts') {
    return path.resolve(__dirname, '../../../packages/contracts');
  }
  try {
    return path.dirname(resolvePackage(`${specifier}/package.json`));
  } catch {
    try {
      const entryPath = resolvePackage(specifier);
      const nodeModulesPart = `/node_modules/${specifier}/`;
      const index = entryPath.lastIndexOf(nodeModulesPart);
      if (index !== -1) return entryPath.slice(0, index + nodeModulesPart.length - 1);
    } catch {
      // Fall through to filesystem probing below.
    }
    for (const root of packageResolutionRoots) {
      const packagePath = path.join(root, ...specifier.split('/'));
      if (existsSync(packagePath)) return packagePath;
    }
    throw new Error(`Unable to resolve package root for ${specifier}`);
  }
}

function resolvePackageStoreRoot(): string {
  for (const root of packageResolutionRoots) {
    try {
      require.resolve('react/package.json', { paths: [root] });
      return root;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Unable to resolve frontend package store root');
}

function ensureFrontendNodeModules(): void {
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    symlinkSync(resolvePackageStoreRoot(), nodeModulesPath, 'dir');
    return;
  }

  const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  for (const dependency of dependencies) {
    const packagePath = path.join(nodeModulesPath, ...dependency.split('/'));
    if (existsSync(packagePath)) continue;
    if (dependency.startsWith('@')) {
      mkdirSync(path.join(nodeModulesPath, dependency.split('/')[0]), { recursive: true });
    }
    symlinkSync(resolvePackageDir(dependency), packagePath, 'dir');
  }
}

ensureFrontendNodeModules();
const { default: react } = await import(/* @vite-ignore */ resolvePackage('@vitejs/plugin-react'));

export default defineConfig({
  plugins: [react()],
  cacheDir: '../../../.cache/vitest-frontend',
  server: { watch: null },
  test: {
    globals: true,
    environment: 'jsdom',
    // canvas-setup.ts must load first — it stubs canvas before test-setup.ts
    // imports @xterm/xterm (which probes canvas on import). See PAN-1989.
    setupFiles: [
      path.resolve(__dirname, './src/canvas-setup.ts'),
      path.resolve(__dirname, './src/test-setup.ts'),
    ],
    include: [
      path.resolve(__dirname, 'src/**/__tests__/**/*.test.{ts,tsx}'),
      path.resolve(__dirname, 'src/**/*.{test,spec}.{ts,tsx}'),
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@overdeck/contracts': path.resolve(__dirname, '../../../packages/contracts/src/index.ts'),
    },
  },
});
