'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  { ignores: ['**/node_modules/**', 'server/data/**', 'design/**'] },
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } }, rules: { 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] } },
  { files: ['server/public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
];
