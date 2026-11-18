const preset = require('@react-native/jest-preset');

module.exports = {
  ...preset,
  // App-level shims must run after the React Native preset's own setup file.
  setupFiles: [...(preset.setupFiles || []), '<rootDir>/jest.setup.js'],
  // This dependency tree contains many duplicated recursive dependencies (e.g.
  // several copies of `source-map` and `ansi-styles`). Jest's Haste map treats
  // duplicated package names as an unresolvable collision, so nested
  // `node_modules` trees are excluded from the crawl. Node/Jest resolution still
  // walks them on disk, which is all the app needs.
  modulePathIgnorePatterns: [
    'node_modules[^A-Za-z0-9_.-].+[^A-Za-z0-9_.-]node_modules[^A-Za-z0-9_.-]',
  ],
  // The preset only transforms React Native packages; these two ship untranspiled
  // ESM and are imported directly by the app.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-webview|react-native-safe-area-context)/)',
  ],
};
