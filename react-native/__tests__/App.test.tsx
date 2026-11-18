/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The app shell mounts several providers that touch native-only modules; the
// smoke test only needs the tree to mount and the first frame to settle.
jest.setTimeout(30000);

test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
