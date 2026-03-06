import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import unusedImports from 'eslint-plugin-unused-imports';
import eslintConfigPrettier from 'eslint-config-prettier';

const eslintConfig = [
  // Next.js native flat configs
  ...nextCoreWebVitals,
  ...nextTypescript,

  // Prettier conflict resolution (must be after next configs)
  eslintConfigPrettier,

  // Custom strict rules
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      // ── TypeScript ──
      '@typescript-eslint/no-unused-vars': 'off', // Replaced by unused-imports
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // ── Unused Imports (auto-fixable!) ──
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // ── React ──
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'error',

      // ── Next.js ──
      '@next/next/no-img-element': 'error',

      // ── General ──
      'prefer-const': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  // ── Per-file overrides ──
  {
    files: ['src/lib/logger.ts'],
    rules: {
      'no-console': 'off', // Logger is the ONLY place console.* is allowed
    },
  },
];

export default eslintConfig;
