/**
 * Jest environment shims.
 *
 * The app imports two modules that need native binaries; tests only exercise the
 * JS layer, so both are replaced with minimal, faithful stand-ins.
 */
jest.mock('react-native-webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  const WebView = React.forwardRef((props, ref) =>
    React.createElement(View, {...props, ref}),
  );
  return {__esModule: true, WebView, default: WebView};
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  const frame = {x: 0, y: 0, width: 390, height: 844};
  return {
    SafeAreaProvider: ({children}) => children,
    SafeAreaView: ({children}) => children,
    SafeAreaConsumer: ({children}) => children(insets),
    SafeAreaFrameContext: React.createContext(frame),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: {insets, frame},
  };
});
