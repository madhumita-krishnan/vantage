'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  { ignores: ['**/node_modules/**', 'server/data/**', 'design/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  { files: ['server/public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
  // The console is several classic scripts sharing one page. Its session state lives in core.js; the other files
  // read and assign it. Functions each file uses from the others are named in a `global` comment at its top.
  {
    files: ['server/public/admin/*.js'],
    ignores: ['server/public/admin/core.js'],
    languageOptions: {
      globals: { token: 'writable', me: 'writable', view: 'writable', left: 'writable', liveTimer: 'writable' },
    },
  },
];
