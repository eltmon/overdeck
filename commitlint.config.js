export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow longer subjects — issue refs (PAN-NNN) push lines over 72 chars
    'header-max-length': [1, 'always', 100],
    // Scopes used in this project
    'scope-enum': [
      1,
      'always',
      [
        'cloister',
        'dashboard',
        'workspace',
        'cli',
        'review',
        'beads',
        'db',
        'specialists',
        'terminal',
        'infra',
        'deps',
      ],
    ],
  },
};
