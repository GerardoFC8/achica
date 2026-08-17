import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The `src/core/**` block is the point of this file.
 *
 * The project's hard rule is that core/ is pure, testable logic: no React,
 * no DOM, no reaching sideways into other layers. A rule that depends on a
 * reviewer remembering it breaks the first time someone is in a hurry, so it
 * is enforced here and fails CI instead.
 */
export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,js}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
              message:
                'core/ is framework-free. Move anything that needs React or the store into ui/ or state/.',
            },
            {
              group: ['**/ui/**', '**/state/**', '**/workers/**', '**/output/**'],
              message:
                'core/ is the innermost layer and must not depend on the layers above it. Invert the dependency: have the caller pass what core/ needs.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message:
            'core/ must not touch the DOM. If a function here needs window, it belongs in ui/, workers/ or output/.',
        },
        {
          name: 'document',
          message: 'core/ must not touch the DOM. Move DOM work to ui/.',
        },
        {
          name: 'navigator',
          message:
            'core/ must not read platform capabilities. Concurrency and feature detection belong in workers/ or output/.',
        },
        {
          name: 'localStorage',
          message: 'core/ must not persist anything. Persistence belongs in state/.',
        },
        {
          name: 'sessionStorage',
          message: 'core/ must not persist anything. Persistence belongs in state/.',
        },
        {
          name: 'indexedDB',
          message: 'core/ must not persist anything. Persistence belongs in state/.',
        },
        {
          name: 'location',
          message: 'core/ must not read the URL.',
        },
        {
          name: 'alert',
          message: 'core/ reports failures by returning typed errors, never by interrupting.',
        },
      ],
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
)
