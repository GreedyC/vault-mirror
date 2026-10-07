// Lint rules: the built-in recommended set, nothing else.
import js from '@eslint/js';

const nodeGlobals = Object.fromEntries(['process', 'console', 'Buffer', 'URL', 'TextDecoder', 'TextEncoder', 'AbortController', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'SharedArrayBuffer', 'Atomics', 'globalThis', 'require', 'module', '__dirname'].map((n) => [n, 'readonly']));

export default [
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'no-control-regex': 'off', 'no-misleading-character-class': 'off' } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  { ignores: ['node_modules/', 'tests/fixtures/'] },
];
