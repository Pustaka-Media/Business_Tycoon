import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'public/**/*', 'scripts/**/*', 'tests/**/*', 'server.js', 'node_modules/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
