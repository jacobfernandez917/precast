import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Node scripts + configs run in the Node runtime (process, console, etc.).
    files: ['scripts/**/*.mjs', '*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      'node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
);
