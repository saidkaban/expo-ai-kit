const { defineConfig } = require('eslint/config');
const baseConfig = require('expo-module-scripts/eslint.config.base');

module.exports = defineConfig([
  {
    ignores: ['build/**', 'example/android/**', 'example/ios/**'],
  },
  baseConfig,
  {
    files: ['**/*.config.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
      },
    },
  },
]);
