import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/api/src/generated/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['tests/**/*.mjs'], languageOptions: { globals: { fetch: 'readonly' } } },
);
