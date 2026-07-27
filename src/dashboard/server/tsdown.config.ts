import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { defineConfig } from 'tsdown';

const execFileAsync = promisify(execFile);

function configYamlSingleChunkAssertion() {
  return {
    name: 'config-yaml-single-chunk-assertion',
    writeBundle(
      _outputOptions: unknown,
      bundle: Record<string, { type: string; fileName: string; modules?: Record<string, unknown> }>,
    ) {
      const chunks = Object.values(bundle).filter((output) => {
        if (output.type !== 'chunk' || !output.modules) return false;
        return Object.keys(output.modules).some((moduleId) => {
          const normalized = moduleId.replaceAll('\\', '/');
          return normalized.endsWith('/src/lib/config-yaml.ts');
        });
      });

      if (chunks.length !== 1) {
        const chunkList = chunks.map((chunk) => chunk.fileName).join(', ') || '(none)';
        throw new Error(
          `Expected src/lib/config-yaml.ts in exactly one dashboard chunk, found ${chunks.length}: ${chunkList}`,
        );
      }
    },
  };
}

function cliEntrypointExclusionAssertion() {
  return {
    name: 'cli-entrypoint-exclusion-assertion',
    writeBundle(
      _outputOptions: unknown,
      bundle: Record<string, { type: string; modules?: Record<string, unknown> }>,
    ) {
      const cliModules = Object.values(bundle)
        .filter(output => output.type === 'chunk' && output.modules)
        .flatMap(output => Object.keys(output.modules ?? {}))
        .filter(moduleId => moduleId.replaceAll('\\', '/').endsWith('/src/cli/index.ts'));

      if (cliModules.length > 0) {
        throw new Error(
          `Dashboard bundle must not import src/cli/index.ts; found ${cliModules.join(', ')}`,
        );
      }
    },
  };
}

function strikeLandingDeaconChunkAssertion() {
  return {
    name: 'strike-landing-deacon-chunk-assertion',
    writeBundle(
      _outputOptions: unknown,
      bundle: Record<string, { type: string; fileName: string; modules?: Record<string, unknown> }>,
    ) {
      const chunks = Object.values(bundle).filter((output) => {
        if (output.type !== 'chunk' || !output.modules) return false;
        return Object.keys(output.modules).some((moduleId) => {
          const normalized = moduleId.replaceAll('\\', '/');
          return normalized.endsWith('/src/lib/cloister/deacon-strike-landing.ts');
        });
      });

      const fileName = chunks[0]?.fileName;
      if (chunks.length !== 1 || !(fileName === 'deacon.js' || fileName?.startsWith('deacon-'))) {
        const chunkList = chunks.map((chunk) => chunk.fileName).join(', ') || '(none)';
        throw new Error(
          'Expected src/lib/cloister/deacon-strike-landing.ts only in the forked deacon.js entry; '
          + `found ${chunks.length} chunk(s): ${chunkList}`,
        );
      }
    },
  };
}

export default defineConfig(async () => {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const buildCommit = stdout.trim();
  const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const buildDirty = statusOutput.trim().length > 0;
  const { stdout: branchOutput } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const branch = branchOutput.trim();
  const buildBranch = branch === 'HEAD' ? null : branch;
  const builtAt = new Date().toISOString();

  return {
    entry: {
      server: 'main.ts',
      deacon: 'deacon-main.ts',
      'dashboard-db-worker': 'services/dashboard-db-worker.ts',
      'checkpoint-worker': '../../lib/memory/checkpoint-worker.ts',
      'memory-fts-worker': '../../lib/memory/fts-worker.ts',
    },
    outDir: '../../../dist/dashboard',
    format: 'esm',
    platform: 'node',
    shims: true,
    define: {
      __OVERDECK_BUILD_COMMIT__: JSON.stringify(buildCommit),
      __OVERDECK_BUILD_TIME__: JSON.stringify(builtAt),
      __OVERDECK_BUILD_DIRTY__: JSON.stringify(buildDirty),
      __OVERDECK_BUILD_BRANCH__: JSON.stringify(buildBranch),
    },
    clean: false,
    sourcemap: true,
    outExtensions: () => ({ js: '.js' }),
    alias: {
      '@overdeck/contracts': resolve(import.meta.dirname, '../../../packages/contracts/src/index.ts'),
    },
    outputOptions: {
      codeSplitting: {
        groups: [
          {
            name: 'config-yaml',
            test: (moduleId: string) => moduleId.replaceAll('\\', '/').endsWith('/src/lib/config-yaml.ts'),
            priority: 10,
          },
        ],
      },
    },
    plugins: [
      cliEntrypointExclusionAssertion(),
      configYamlSingleChunkAssertion(),
      strikeLandingDeaconChunkAssertion(),
    ],
    deps: {
      alwaysBundle: [/^@overdeck\//],
      neverBundle: [
        '@lydell/node-pty',
        'ssh2',
        // PAN-1645: playwright is loaded only via a runtime `await import('playwright')`
        // (artifact thumbnails). Bundling it pulls in playwright-core's prebundled
        // coreBundle.js, which has an internal `require("chromium-bidi/...")` for a
        // package playwright does not ship — emitting UNRESOLVED_IMPORT warnings that
        // the workspace docker `init` guard turns into exit 1 (forcing --host).
        // Externalizing it keeps it resolved from node_modules at runtime and drops
        // a 5.6 MB browser chunk from the server bundle.
        'playwright',
        'playwright-core',
        /^chromium-bidi/,
        /^bun:/,
        /^@effect\/platform-bun/,
      ],
    },
  };
});
