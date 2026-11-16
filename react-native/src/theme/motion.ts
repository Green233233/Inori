import {Easing, Platform} from 'react-native';

/** Shared interaction timings. Keep feedback <= 200ms. */
export const DURATION = {
  instant: 100,
  feedback: 140,
  fast: 160,
  base: 200,
  sheet: 240,
  route: 300,
  count: 450,
  skeleton: 900,
} as const;

export const EASE = {
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  linear: Easing.linear,
} as const;

export const spring = {
  press: {damping: 18, stiffness: 260, mass: 0.7},
  pop: {damping: 14, stiffness: 220, mass: 0.8},
} as const;

/** Android's hardware layer is a real cost; only use on transform loops. */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';
