import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'dev-dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclarator[id.type="ObjectPattern"][init.type="CallExpression"][init.callee.name=/^use.+Store$/]',
          message: 'NEVER destructure Zustand stores. Use named selectors: useStore(selectItem) instead of const { item } = useStore().',
        },
      ],
    },
  },
)
