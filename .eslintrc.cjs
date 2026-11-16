require('@typescript-eslint/eslint-plugin');

let anyAllowlist = [];
try {
  anyAllowlist = require('./eslint-any-allowlist.json');
} catch {
  // The allowlist is generated in A1 WI-3; keep bootstrap lint config loadable.
}

let compilerAllowlist = [];
try {
  compilerAllowlist = require('./eslint-react-compiler-allowlist.json');
} catch {
  // PAN-4561: files that broke a compiler rule when the rules were turned on.
}

// PAN-4561: React Compiler rules (eslint-plugin-react-hooks 7) for dashboard
// frontend source. docs/DASHBOARD-ARCHITECTURE.md, React Compiler.
const REACT_COMPILER_RULES = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/static-components': 'error',
  'react-hooks/use-memo': 'error',
  'react-hooks/preserve-manual-memoization': 'error',
  'react-hooks/incompatible-library': 'error',
  'react-hooks/immutability': 'error',
  'react-hooks/globals': 'error',
  'react-hooks/refs': 'error',
  'react-hooks/set-state-in-effect': 'error',
  'react-hooks/error-boundaries': 'error',
  'react-hooks/purity': 'error',
  'react-hooks/set-state-in-render': 'error',
  'react-hooks/unsupported-syntax': 'error',
  'react-hooks/config': 'error',
  'react-hooks/gating': 'error',
};

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
      files: ['src/dashboard/frontend/src/**/*.ts', 'src/dashboard/frontend/src/**/*.tsx'],
      excludedFiles: [
        'src/dashboard/frontend/src/**/*.test.ts',
        'src/dashboard/frontend/src/**/*.test.tsx',
        'src/dashboard/frontend/src/**/__tests__/**',
        'src/dashboard/frontend/src/test-utils/**',
      ],
      plugins: ['react-hooks'],
      rules: {
        ...REACT_COMPILER_RULES,
        // The compiler validates memo dependencies itself; PAN-4561 Decision 6 keeps this off.
        'react-hooks/exhaustive-deps': 'off',
      },
    },
    ...(compilerAllowlist.length
      ? [{ files: compilerAllowlist, rules: Object.fromEntries(Object.keys(REACT_COMPILER_RULES).map((r) => [r, 'off'])) }]
      : []),
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
