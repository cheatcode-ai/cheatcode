import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'error',
      '@next/next/no-img-element': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'error',
      'no-console': 'error',
    },
  },
];

export default eslintConfig;
