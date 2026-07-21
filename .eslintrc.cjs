require('@typescript-eslint/eslint-plugin');

let anyAllowlist = [];
try {
  anyAllowlist = require('./eslint-any-allowlist.json');
} catch {
  // The allowlist is generated in A1 WI-3; keep bootstrap lint config loadable.
}

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist/', 'node_modules/', 'src/lib/caveman/*.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: true }],
  },
  overrides: [
    {
      files: ['src/dashboard/server/**/*.ts'],
      excludedFiles: [
        'src/dashboard/server/**/*.test.ts',
        'src/dashboard/server/**/__tests__/**/*.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "ImportSpecifier[imported.name='execSync']",
            message: 'Dashboard server code must not import execSync; use async execFile/spawn helpers instead.',
          },
          {
            selector: "ImportSpecifier[imported.name='execFileSync']",
            message: 'Dashboard server code must not import execFileSync; use async execFile/spawn helpers instead.',
          },
          {
            selector: "ImportSpecifier[imported.name='spawnSync']",
            message: 'Dashboard server code must not import spawnSync; use async execFile/spawn helpers instead.',
          },
          {
            selector: "ImportSpecifier[imported.name='listSessionsSync']",
            message: 'Dashboard server code must not import listSessionsSync; use listSessions() from lib/tmux instead.',
          },
          {
            selector: "CallExpression[callee.name='execSync']",
            message: 'Dashboard server code must not call execSync; use async execFile/spawn helpers instead.',
          },
          {
            selector: "CallExpression[callee.name='execFileSync']",
            message: 'Dashboard server code must not call execFileSync; use async execFile/spawn helpers instead.',
          },
          {
            selector: "CallExpression[callee.name='spawnSync']",
            message: 'Dashboard server code must not call spawnSync; use async execFile/spawn helpers instead.',
          },
        ],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    ...(anyAllowlist.length
      ? [
          {
            files: anyAllowlist,
            rules: {
              '@typescript-eslint/no-explicit-any': 'off',
            },
          },
        ]
      : []),
  ],
};
