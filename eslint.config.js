import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore patterns
  {
    ignores: ['node_modules/', 'dist/', 'data/', '*.log', '.env', '.env.*']
  },

  // Base configuration for all JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'no-debugger': 'warn'
    }
  },

  // CommonJS files (CLI scripts)
  {
    files: ['lego-cli.js', 'deep-analysis.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },

  // ES Module files (frontend)
  {
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    }
  }
];
