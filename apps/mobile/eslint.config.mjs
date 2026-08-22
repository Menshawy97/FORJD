import reactHooks from 'eslint-plugin-react-hooks';

import rootConfig from '../../eslint.config.mjs';

// Extends the repo's root flat config (see eslint.config.mjs) rather than replacing it,
// mirroring apps/api's convention of using the shared config as-is. The one override below
// exists because React Native/Expo's static-asset loading (`require('./icon.png')`,
// `require('./Archivo-Variable.ttf')`) is idiomatic and necessary — Metro bundles these
// specially and there is no ESM `import` equivalent — unlike a plain Node/Nest module where
// a require() call is genuinely something to flag.
export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
