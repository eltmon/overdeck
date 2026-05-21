/**
 * Test command detection for the test-agent specialist.
 *
 * The actual test-agent spawning path lives in the role runner / ephemeral
 * specialist bridge. This module only
 * exposes `detectTestCommand`, which inspects a project's build files to
 * pick a sane default test command when one isn't configured in
 * cloister.toml.
 */

import { readFileSync, existsSync } from 'fs';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { loadCloisterConfig } from './config.js';

/**
 * Detect test command from project structure.
 *
 * Priority order:
 * 1. Explicit config from cloister.toml
 * 2. package.json scripts.test
 * 3. File pattern detection (jest, vitest, pytest, cargo, mvn, gradle, go)
 *
 * Returns 'auto' if no test command could be detected.
 */
export function detectTestCommand(projectPath: string): string {
  try {
    const config = loadCloisterConfig();
    if (config.specialists?.test_agent?.test_command) {
      return config.specialists.test_agent.test_command;
    }
  } catch {
    // Config not available, continue with auto-detection
  }

  const packageJsonPath = join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // Ignore parse errors
    }
  }

  const jestConfigs = ['jest.config.js', 'jest.config.ts', 'jest.config.json', 'jest.config.mjs'];
  if (jestConfigs.some((c) => existsSync(join(projectPath, c)))) {
    return 'npm test';
  }

  const vitestConfigs = ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'];
  if (vitestConfigs.some((c) => existsSync(join(projectPath, c)))) {
    return 'npm test';
  }

  const pytestFiles = ['pytest.ini', 'setup.py', 'pyproject.toml'];
  if (pytestFiles.some((f) => existsSync(join(projectPath, f)))) {
    return 'pytest';
  }

  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    return 'cargo test';
  }

  if (existsSync(join(projectPath, 'pom.xml'))) {
    return 'mvn test';
  }

  if (existsSync(join(projectPath, 'build.gradle')) || existsSync(join(projectPath, 'build.gradle.kts'))) {
    return 'gradle test';
  }

  if (existsSync(join(projectPath, 'go.mod'))) {
    return 'go test ./...';
  }

  return 'auto';
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

const fileExists = (path: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () => access(path).then(() => true).catch(() => false),
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

/**
 * Effect variant of {@link detectTestCommand}. Uses `fs/promises` instead of
 * sync filesystem APIs. Same priority order: config → package.json → file
 * patterns. Errors are swallowed (returns `'auto'`) to match the original
 * permissive contract.
 */
export const detectTestCommandEffect = (
  projectPath: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    // 1. Explicit config
    const fromConfig = yield* Effect.sync(() => {
      try {
        const config = loadCloisterConfig();
        return config.specialists?.test_agent?.test_command ?? null;
      } catch {
        return null;
      }
    });
    if (fromConfig) return fromConfig;

    // 2. package.json scripts.test
    const packageJsonPath = join(projectPath, 'package.json');
    const hasPackageJson = yield* fileExists(packageJsonPath);
    if (hasPackageJson) {
      const npmTest = yield* Effect.tryPromise({
        try: async () => {
          const raw = await readFile(packageJsonPath, 'utf-8');
          const pkg = JSON.parse(raw) as { scripts?: { test?: string } };
          return pkg.scripts?.test ? 'npm test' : null;
        },
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      if (npmTest) return npmTest;
    }

    // 3. File-pattern detection
    const groups: Array<readonly [readonly string[], string]> = [
      [['jest.config.js', 'jest.config.ts', 'jest.config.json', 'jest.config.mjs'], 'npm test'],
      [['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'], 'npm test'],
      [['pytest.ini', 'setup.py', 'pyproject.toml'], 'pytest'],
      [['Cargo.toml'], 'cargo test'],
      [['pom.xml'], 'mvn test'],
      [['build.gradle', 'build.gradle.kts'], 'gradle test'],
      [['go.mod'], 'go test ./...'],
    ];
    for (const [candidates, cmd] of groups) {
      for (const c of candidates) {
        if (yield* fileExists(join(projectPath, c))) return cmd;
      }
    }

    return 'auto';
  });
