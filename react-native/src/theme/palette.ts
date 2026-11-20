/**
 * Pop-glass color schemes inspired by Apple`s design language, but NOT SAMEEEEEEEE :-)
 * near-black canvas, editorial white type, bright album-art-like color blocks.
 * Three scheme enums are kept for settings compatibility; labels/surfaces are
 * re-themed. No warm cream/paper palette and no blue-purple tech gradients.
 */
export interface ColorScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  error: string;
  onError: string;
}

/**
 *The theme are named as SAKURA, MINT, PERIWINKLE, SYSTEM. 
 *The little said she like these 3 colors, so I named the theme as these colors.:)
 */

export type ColorStyleName = 'SAKURA' | 'MINT' | 'PERIWINKLE' | 'SYSTEM';
export type ThemeModeName = 'LIGHT' | 'DARK' | 'SYSTEM';

const SAKURA_LIGHT: ColorScheme = {
  primary: '#FA2D48',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFE0E4',
  onPrimaryContainer: '#47000C',
  secondary: '#007AFF',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D6E9FF',
  onSecondaryContainer: '#002B5C',
  tertiary: '#65C400',
  onTertiary: '#102000',
  background: '#F5F5F7',
  onBackground: '#111114',
  surface: '#FFFFFF',
  onSurface: '#111114',
  surfaceVariant: '#ECECF0',
  onSurfaceVariant: '#6E6E73',
  outline: '#C7C7CC',
  error: '#D70015',
  onError: '#FFFFFF',
};

// 深色统一用 #212121 纯色底（用户要求），只保留经典版的暖色强调色。
const DARK_CANVAS = '#212121';
const DARK_SURFACE = '#2A2A2A';
const DARK_SURFACE_VARIANT = '#333333';
const DARK_ON = '#F2F2F2';
const DARK_ON_VARIANT = '#B8B8B8';
const DARK_OUTLINE = '#4D4D4D';

const SAKURA_DARK: ColorScheme = {
  // 深色保留纯色 #212121 画布，但强调色与浅色一致（用户要求：草莓波普的深色跟着浅色走）
  primary: '#FA2D48',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFE0E4',
  onPrimaryContainer: '#47000C',
  secondary: '#007AFF',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D6E9FF',
  onSecondaryContainer: '#002B5C',
  tertiary: '#65C400',
  onTertiary: '#102000',
  background: DARK_CANVAS,
  onBackground: DARK_ON,
  surface: DARK_SURFACE,
  onSurface: DARK_ON,
  surfaceVariant: DARK_SURFACE_VARIANT,
  onSurfaceVariant: DARK_ON_VARIANT,
  outline: DARK_OUTLINE,
  error: '#FFB4AB',
  onError: '#690005',
};

const MINT_LIGHT: ColorScheme = {
  primary: '#0E9F5A',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D5F5E3',
  onPrimaryContainer: '#003B20',
  secondary: '#007AFF',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D6E9FF',
  onSecondaryContainer: '#002B5C',
  tertiary: '#F5C200',
  onTertiary: '#241A00',
  background: '#F2F7F2',
  onBackground: '#111513',
  surface: '#FFFFFF',
  onSurface: '#111513',
  surfaceVariant: '#E6EFE6',
  onSurfaceVariant: '#66756A',
  outline: '#B9C7BC',
  error: '#D70015',
  onError: '#FFFFFF',
};

const MINT_DARK: ColorScheme = {
  primary: '#6FE0C0',
  onPrimary: '#063028',
  primaryContainer: '#1C5548',
  onPrimaryContainer: '#C9F7E8',
  secondary: '#FF9B70',
  onSecondary: '#3A1606',
  secondaryContainer: '#5C2C18',
  onSecondaryContainer: '#FFD9C7',
  tertiary: '#F2C94C',
  onTertiary: '#3A2A02',
  background: DARK_CANVAS,
  onBackground: DARK_ON,
  surface: DARK_SURFACE,
  onSurface: DARK_ON,
  surfaceVariant: DARK_SURFACE_VARIANT,
  onSurfaceVariant: DARK_ON_VARIANT,
  outline: DARK_OUTLINE,
  error: '#FFB4AB',
  onError: '#690005',
};

const PERIWINKLE_LIGHT: ColorScheme = {
  primary: '#007AFF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D6E9FF',
  onPrimaryContainer: '#002B5C',
  secondary: '#FF2D55',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFE0E6',
  onSecondaryContainer: '#4A0014',
  tertiary: '#65C400',
  onTertiary: '#102000',
  background: '#F2F5FA',
  onBackground: '#11151D',
  surface: '#FFFFFF',
  onSurface: '#11151D',
  surfaceVariant: '#E6EDF7',
  onSurfaceVariant: '#667080',
  outline: '#B8C2D0',
  error: '#D70015',
  onError: '#FFFFFF',
};

const PERIWINKLE_DARK: ColorScheme = {
  // 同上：电光蓝调深色也用浅色的强调色
  primary: '#007AFF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D6E9FF',
  onPrimaryContainer: '#002B5C',
  secondary: '#FF2D55',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFE0E6',
  onSecondaryContainer: '#4A0014',
  tertiary: '#65C400',
  onTertiary: '#102000',
  background: DARK_CANVAS,
  onBackground: DARK_ON,
  surface: DARK_SURFACE,
  onSurface: DARK_ON,
  surfaceVariant: DARK_SURFACE_VARIANT,
  onSurfaceVariant: DARK_ON_VARIANT,
  outline: DARK_OUTLINE,
  error: '#FFB4AB',
  onError: '#690005',
};

export const SCHEMES: Record<
  Exclude<ColorStyleName, 'SYSTEM'>,
  {light: ColorScheme; dark: ColorScheme}
> = {
  SAKURA: {light: SAKURA_LIGHT, dark: SAKURA_DARK},
  MINT: {light: MINT_LIGHT, dark: MINT_DARK},
  PERIWINKLE: {light: PERIWINKLE_LIGHT, dark: PERIWINKLE_DARK},
};

export const CATEGORY_ACCENT: Record<string, string> = {
  ALL: '#0A84FF',
  DAILY: '#FFD60A',
  WORK: '#FF9F0A',
  GOAL: '#28CD41',
  INSPIRATION: '#FF375F',
  EMOTION: '#32D7FF',
};

export const ACCENT = {
  favoriteRed: '#FF375F',
  starYellow: '#FFD60A',
  fireOrange: '#FF9F0A',
  darkGrey: '#111114',
  white: '#FFFFFF',
};

/** Hex -> RGB triple. Assumes a well-formed `#RRGGBB` string. */
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Linear per-channel blend, used for the neutral dark surfaces. */
export function mixColor(from: string, to: string, ratio: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const out = a.map((value, index) =>
    Math.round(value + (b[index] - value) * ratio),
  );
  return `#${out
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Pick white or near-black text/icon for a solid accent block. */
export function onAccentFor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.62 ? '#111114' : '#FFFFFF';
}

export function resolveScheme(
  style: ColorStyleName,
  dark: boolean,
): ColorScheme {
  const key = style === 'SYSTEM' ? 'SAKURA' : style;
  return SCHEMES[key][dark ? 'dark' : 'light'];
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export interface SurfaceTokens {
  raised: string;
  raisedAlt: string;
  sunken: string;
  glass: string;
  glassStrong: string;
  highlight: string;
  highlightSoft: string;
  shadow: string;
  shadowSoft: string;
  ambientA: string;
  ambientB: string;
}

export function buildSurfaces(
  colors: ColorScheme,
  isDark: boolean,
): SurfaceTokens {
  return {
    // 浅色沿用原来的玻璃/纸质层级；深色只保留中性灰阶，配合纯色 #212121 画布。
    raised: isDark ? mixColor(colors.surface, '#FFFFFF', 0.05) : '#FFFFFF',
    raisedAlt: isDark ? mixColor(colors.surface, '#000000', 0.18) : '#F7F7FA',
    sunken: isDark ? mixColor(colors.background, '#000000', 0.18) : '#EDEDF2',
    glass: withAlpha(isDark ? colors.background : '#FFFFFF', isDark ? 0.66 : 0.80),
    glassStrong: withAlpha(
      isDark ? colors.surface : '#FFFFFF',
      isDark ? 0.94 : 0.98,
    ),
    highlight: isDark ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.92)',
    highlightSoft: isDark
      ? 'rgba(255,255,255,0.055)'
      : 'rgba(255,255,255,0.58)',
    shadow: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)',
    shadowSoft: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.07)',
    // 深色要求「纯色底」，所以环境光晕在深色下完全关掉。
    ambientA: isDark ? 'rgba(0,0,0,0)' : withAlpha(colors.primary, 0.10),
    ambientB: isDark ? 'rgba(0,0,0,0)' : withAlpha(colors.secondary, 0.08),
  };
}
