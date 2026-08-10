import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The daemon interops with loosely-typed external payloads; flag `any`
      // as a warning rather than blocking the build on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow the declare-then-assign-in-closure timer pattern (a closure reads
      // the binding before it is assigned, so `const` is not applicable).
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // Tests must not depend on the machine they run on. A config test once
    // read the developer's real ~/.agent-server, broke the moment that Mac
    // was paired, and printed the live Panel credential into the failure
    // output. Inject paths and lookups instead; a deliberate exception can
    // disable the rule on one line with a comment saying why.
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='homedir']",
          message: 'Tests must not read the real home directory. Inject the path.',
        },
      ],
    },
  },
);
