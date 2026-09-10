import tsPlugin  from '@typescript-eslint/eslint-plugin';
import tsParser  from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', '__tests__/**/*.ts'],
    plugins: { '@typescript-eslint': tsPlugin },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any':  'warn',
      '@typescript-eslint/no-unused-vars':   ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/', '.next/', 'coverage/', 'tsconfig.tsbuildinfo', 'next-env.d.ts'],
  },
];
