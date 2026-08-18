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
    // Node scripts + configs run in the Node runtime. The list below is not
    // decorative: an unlisted global is a `no-undef` ERROR, and because
    // lint-staged runs eslint on staged files, a missing entry blocks any commit
    // that touches these scripts. `fetch`/`AbortSignal`/`setTimeout` arrived with
    // the v0.4.0+ scripts (poc.mjs, check-docker.mjs) and were exactly that.
    files: ['scripts/**/*.mjs', '*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: {
      // `const [, , _stale] = …` — destructuring past a value you don't want is
      // the normal way to read the third element, so the underscore convention
      // has to be honoured or the script cannot be written cleanly.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // rename-project.mjs masks protected spans with NUL sentinels, which is
      // deliberate: they cannot occur in source, so they cannot collide with it.
      'no-control-regex': 'off',
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
