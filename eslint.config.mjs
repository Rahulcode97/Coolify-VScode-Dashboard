import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['media/**/*.js'],
    languageOptions: { globals: { ...globals.browser, acquireVsCodeApi: 'readonly' }, sourceType: 'script' },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'esbuild.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
