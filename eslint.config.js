import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The layer boundaries are the point of this file.
 *
 * The project's hard rule is that core/ is pure, testable logic: no React, no
 * DOM, no reaching sideways into other layers. A rule that depends on a
 * reviewer remembering it breaks the first time someone is in a hurry, so it
 * is enforced here and fails CI instead.
 *
 * Note on flat config: rules override, they do not merge. Two blocks matching
 * the same file means the later one wins outright, so the restricted-import
 * patterns are composed as data below rather than repeated per block.
 */

const NODE_BUILTINS = {
  group: ['node:*', 'fs', 'path', 'url', 'zlib', 'crypto'],
  message: 'src/ runs in the browser. Node builtins belong in scripts/ or test/.',
}

const FRAMEWORK = {
  group: ['react', 'react-*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
  message:
    'core/ is framework-free. Move anything that needs React or the store into ui/ or state/.',
}

const OUTER_LAYERS = {
  group: ['**/ui/**', '**/state/**', '**/workers/**', '**/output/**'],
  message:
    'core/ is the innermost layer and must not depend on the layers above it. Invert the dependency: have the caller pass what core/ needs.',
}

const TEST_FILES = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.browser-test.ts',
  '**/*.browser-test.tsx',
]

const restrictImports = (...patterns) => ['error', { patterns }]

const forbidGlobal = (name, message) => ({ name, message })

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  {
    // Tooling: fixture generation and tests read from disk, so Node globals
    // are legitimate here. Browser globals too, because the bodies passed to
    // page.evaluate() are written in these files but run inside Chromium.
    files: ['scripts/**/*.{ts,js,mjs}', 'test/**/*.ts', 'src/**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    // src/ is browser code. Reaching for a Node builtin here means the file is
    // in the wrong place.
    //
    // Test files are exempt: they load fixtures from disk and never reach the
    // bundle, so the boundary they would protect does not exist for them. The
    // rules themselves stay guarded by test/architecture.test.ts.
    files: ['src/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': restrictImports(NODE_BUILTINS),
    },
  },

  {
    files: ['src/core/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': restrictImports(NODE_BUILTINS, FRAMEWORK, OUTER_LAYERS),
      'no-restricted-globals': [
        'error',
        forbidGlobal(
          'window',
          'core/ must not touch the DOM. If a function here needs window, it belongs in ui/, workers/ or output/.',
        ),
        forbidGlobal('document', 'core/ must not touch the DOM. Move DOM work to ui/.'),
        forbidGlobal(
          'navigator',
          'core/ must not read platform capabilities. Concurrency and feature detection belong in workers/ or output/.',
        ),
        forbidGlobal(
          'localStorage',
          'core/ must not persist anything. Persistence belongs in state/.',
        ),
        forbidGlobal(
          'sessionStorage',
          'core/ must not persist anything. Persistence belongs in state/.',
        ),
        forbidGlobal(
          'indexedDB',
          'core/ must not persist anything. Persistence belongs in state/.',
        ),
        forbidGlobal('location', 'core/ must not read the URL.'),
        forbidGlobal(
          'alert',
          'core/ reports failures by returning typed errors, never by interrupting.',
        ),
      ],
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
)
