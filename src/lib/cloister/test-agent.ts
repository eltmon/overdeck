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
import { join } from 'path';
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
