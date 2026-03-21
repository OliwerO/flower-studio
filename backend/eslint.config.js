import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Catch real bugs
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$|^req$|^res$', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-duplicate-case': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'warn',
      'eqeqeq': ['warn', 'always'],

      // Import hygiene
      'no-duplicate-imports': 'warn',

      // Async safety
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'warn',

      // Style (light — not a formatter)
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    ignores: ['node_modules/**'],
  },
];
