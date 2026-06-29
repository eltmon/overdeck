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
