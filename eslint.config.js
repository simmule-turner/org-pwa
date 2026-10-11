// Lint for the app (browser modules), the engine (src/, also run by Node), the tools and the tests.
// Dev only: `npm install --no-save eslint @eslint/js globals typescript`, then `npm run lint`.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'src/vendor/**', 'native/**', 'examples/**', 'test/fixtures/**', 'docs/**', 'icons/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      // Real mistakes are errors; style is left to the code's own habits.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'warn',
      'no-useless-escape': 'error',
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'off', // rethrowing with a plainer message is the app's habit
      'no-regex-spaces': 'off',
      'no-control-regex': 'off', // the exporters and parsers match control characters on purpose
      'no-misleading-character-class': 'off',
    },
  },
  { files: ['app.js', 'src-browser/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['src/**/*.js', 'sw.js'], languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } } },
  { files: ['tools/**/*.mjs', 'test/**/*.js', 'test/**/*.mjs', 'eslint.config.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
