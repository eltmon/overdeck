/**
 * Tests for Test Agent Multi-Runner Detection
 *
 * Verifies that test-agent can detect and run tests for different test runners:
 * - npm (jest/vitest)
 * - pytest
 * - cargo test
 * - mvn test
 * - go test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { detectTestCommand } from '../../../src/lib/cloister/test-agent.js';

describe('Test Agent Multi-Runner Detection', () => {
  const testDir = join(process.cwd(), '.test-runner-detection');

  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Node.js Projects', () => {
    it('should detect npm test from package.json', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          test: 'jest',
        },
        devDependencies: {
          jest: '^29.0.0',
        },
      };

      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const command = detectTestCommand(testDir);

      expect(command).toBe('npm test');
    });

    it('should detect npm test for vitest from package.json', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          test: 'vitest',
        },
        devDependencies: {
          vitest: '^1.0.0',
        },
      };

      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const command = detectTestCommand(testDir);

      expect(command).toBe('npm test');
    });

    it('should detect jest from config file', () => {
      const jestConfig = {
        testEnvironment: 'node',
        testMatch: ['**/*.test.ts'],
      };

      writeFileSync(join(testDir, 'jest.config.json'), JSON.stringify(jestConfig, null, 2));

      const command = detectTestCommand(testDir);

      expect(command).toBe('npm test');
    });

    it('should detect vitest from config file', () => {
      const vitestConfig = `
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
`;

      writeFileSync(join(testDir, 'vitest.config.ts'), vitestConfig);

      const command = detectTestCommand(testDir);

      expect(command).toBe('npm test');
    });
  });

  describe('Python Projects', () => {
    it('should detect pytest from pytest.ini', () => {
      const pytestIni = `
[pytest]
testpaths = tests
python_files = test_*.py
`;

      writeFileSync(join(testDir, 'pytest.ini'), pytestIni);

      const command = detectTestCommand(testDir);

      expect(command).toBe('pytest');
    });

    it('should detect pytest from pyproject.toml', () => {
      const pyprojectToml = `
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
`;

      writeFileSync(join(testDir, 'pyproject.toml'), pyprojectToml);

      const command = detectTestCommand(testDir);

      expect(command).toBe('pytest');
    });

    it('should detect pytest from setup.py', () => {
      const setupPy = `
from setuptools import setup

setup(
    name="test-project",
    version="1.0.0",
    test_suite="pytest",
)
`;

      writeFileSync(join(testDir, 'setup.py'), setupPy);

      const command = detectTestCommand(testDir);

      expect(command).toBe('pytest');
    });
  });

  describe('Rust Projects', () => {
    it('should detect cargo test from Cargo.toml', () => {
      const cargoToml = `
[package]
name = "test-project"
version = "1.0.0"
edition = "2021"

[dependencies]
`;

      writeFileSync(join(testDir, 'Cargo.toml'), cargoToml);

      const command = detectTestCommand(testDir);

      expect(command).toBe('cargo test');
    });

    it('should detect workspace cargo project', () => {
      const cargoToml = `
[workspace]
members = ["crate1", "crate2"]

[package]
name = "test-workspace"
version = "1.0.0"
`;

      writeFileSync(join(testDir, 'Cargo.toml'), cargoToml);

      const command = detectTestCommand(testDir);

      expect(command).toBe('cargo test');
    });
  });

  describe('Java Projects', () => {
    it('should detect maven from pom.xml', () => {
      const pomXml = `
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>test-project</artifactId>
  <version>1.0.0</version>
</project>
`;

      writeFileSync(join(testDir, 'pom.xml'), pomXml);

      const command = detectTestCommand(testDir);

      expect(command).toBe('mvn test');
    });

    it('should detect gradle from build.gradle', () => {
      const buildGradle = `
plugins {
    id 'java'
}

group 'com.example'
version '1.0.0'
`;

      writeFileSync(join(testDir, 'build.gradle'), buildGradle);

      const command = detectTestCommand(testDir);

      expect(command).toBe('gradle test');
    });

    it('should detect gradle kotlin from build.gradle.kts', () => {
      const buildGradleKts = `
plugins {
    kotlin("jvm") version "1.9.0"
}

group = "com.example"
version = "1.0.0"
`;

      writeFileSync(join(testDir, 'build.gradle.kts'), buildGradleKts);

      const command = detectTestCommand(testDir);

      expect(command).toBe('gradle test');
    });
  });

  describe('Go Projects', () => {
    it('should detect go test from go.mod', () => {
      const goMod = `
module github.com/example/test-project

go 1.21
`;

      writeFileSync(join(testDir, 'go.mod'), goMod);

      const command = detectTestCommand(testDir);

      expect(command).toBe('go test ./...');
    });
  });

  describe('No Test Runner', () => {
    it('should return "auto" when no test runner is detected', () => {
      // Empty directory
      const command = detectTestCommand(testDir);

      expect(command).toBe('auto');
    });

    it('should return "auto" for non-test projects', () => {
      // Create a README but no test files
      writeFileSync(join(testDir, 'README.md'), '# Test Project');

      const command = detectTestCommand(testDir);

      expect(command).toBe('auto');
    });
  });

  describe('Detection Priority', () => {
    it('should prioritize package.json when multiple markers exist', () => {
      // Create multiple project files
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'vitest',
        },
      };

      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
      writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "test"');

      const command = detectTestCommand(testDir);

      // Should prefer npm over cargo (package.json has higher priority)
      expect(command).toBe('npm test');
    });

    it('should prioritize pytest over cargo', () => {
      writeFileSync(join(testDir, 'pytest.ini'), '[pytest]');
      writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "test"');

      const command = detectTestCommand(testDir);

      // Should prefer pytest (detected earlier in priority chain)
      expect(command).toBe('pytest');
    });

    it('should prioritize cargo over maven', () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "test"');
      writeFileSync(join(testDir, 'pom.xml'), '<project></project>');

      const command = detectTestCommand(testDir);

      // Should prefer cargo (detected earlier)
      expect(command).toBe('cargo test');
    });

    it('should prioritize maven over gradle', () => {
      writeFileSync(join(testDir, 'pom.xml'), '<project></project>');
      writeFileSync(join(testDir, 'build.gradle'), 'plugins {}');

      const command = detectTestCommand(testDir);

      // Should prefer maven (detected earlier)
      expect(command).toBe('mvn test');
    });

    it('should prioritize gradle over go', () => {
      writeFileSync(join(testDir, 'build.gradle'), 'plugins {}');
      writeFileSync(join(testDir, 'go.mod'), 'module test');

      const command = detectTestCommand(testDir);

      // Should prefer gradle (detected earlier)
      expect(command).toBe('gradle test');
    });
  });

  describe('Priority Order Documentation', () => {
    it('should follow detection priority: package.json > jest/vitest config > pytest > cargo > mvn > gradle > go', () => {
      // This test documents the expected priority order
      // 1. package.json (Node.js with test script)
      // 2. jest.config.* or vitest.config.* (Node.js without test script)
      // 3. pytest.ini/setup.py/pyproject.toml (Python)
      // 4. Cargo.toml (Rust)
      // 5. pom.xml (Maven)
      // 6. build.gradle/build.gradle.kts (Gradle)
      // 7. go.mod (Go)

      // The actual priority is tested in the "Detection Priority" section
      expect(true).toBe(true); // Documentation test
    });
  });
});
