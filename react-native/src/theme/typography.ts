import {TextStyle} from 'react-native';

/**
 * Editorial type scale for the Apple Music-inspired direction.
 * System sans only; the journal editor keeps its own WenKai font.
 */
export const type = {
  display: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  displayCompact: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  title: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  section: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headline: {fontSize: 17, lineHeight: 22, fontWeight: '600'},
  body: {fontSize: 15, lineHeight: 20, fontWeight: '400'},
  bodyStrong: {fontSize: 15, lineHeight: 20, fontWeight: '600'},
  caption: {fontSize: 12, lineHeight: 16, fontWeight: '500'},
  label: {fontSize: 11, lineHeight: 14, fontWeight: '600'},
  nav: {fontSize: 11, lineHeight: 14, fontWeight: '600'},
} satisfies Record<string, TextStyle>;

export const tabularNums: TextStyle = {fontVariant: ['tabular-nums']};
