import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' };

export default tseslint.config(
  { ignores: ['dist/', 'release/', 'node_modules/', 'public/', 'playwright-report/', 'test-results/', 'tests/e2e/.harness/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    // TypeScript already checks undefined identifiers (and knows DOM/worker globals).
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.js'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden (MV3 + Trusted Types).' },
        { selector: "NewExpression[callee.name='Function']", message: 'new Function is forbidden.' },
      ],
    },
  },
);
