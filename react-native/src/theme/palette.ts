/**
 * Pop-glass color schemes inspired by Apple Music "New" (not Apple assets):
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

const SAKURA_DARK: ColorScheme = {
  primary: '#FF2D55',
  onPrimary: '#2A0008',
  primaryContainer: '#5C1020',
  onPrimaryContainer: '#FFD9DE',
  secondary: '#32D7FF',
  onSecondary: '#003A52',
  secondaryContainer: '#0B3B57',
  onSecondaryContainer: '#C9F2FF',
  tertiary: '#C6FF3D',
  onTertiary: '#1A2400',
  background: '#050507',
  onBackground: '#F5F5F7',
  surface: '#121216',
  onSurface: '#F5F5F7',
  surfaceVariant: '#1C1C22',
  onSurfaceVariant: '#A1A1AA',
  outline: '#3A3A42',
  error: '#FF453A',
  onError: '#2A0000',
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
  primary: '#C6FF3D',
  onPrimary: '#1A2400',
  primaryContainer: '#33420A',
  onPrimaryContainer: '#E6FFC2',
  secondary: '#64D2FF',
  onSecondary: '#003A52',
  secondaryContainer: '#0B3B57',
  onSecondaryContainer: '#C9F2FF',
  tertiary: '#FFD60A',
  onTertiary: '#241A00',
  background: '#050805',
  onBackground: '#F2F7EE',
  surface: '#10150F',
  onSurface: '#F2F7EE',
  surfaceVariant: '#1B241A',
  onSurfaceVariant: '#A5B5A5',
  outline: '#354034',
  error: '#FF453A',
  onError: '#2A0000',
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
  primary: '#4DA3FF',
  onPrimary: '#001B3A',
  primaryContainer: '#0B2A4A',
  onPrimaryContainer: '#C9E3FF',
  secondary: '#FF6482',
  onSecondary: '#3A0010',
  secondaryContainer: '#5C1024',
  onSecondaryContainer: '#FFD9E0',
  tertiary: '#C6FF3D',
  onTertiary: '#1A2400',
  background: '#04070C',
  onBackground: '#F2F6FC',
  surface: '#0E141C',
  onSurface: '#F2F6FC',
  surfaceVariant: '#17202C',
  onSurfaceVariant: '#9AA7B8',
  outline: '#354254',
  error: '#FF453A',
  onError: '#2A0000',
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
    raised: isDark ? colors.surfaceVariant : '#FFFFFF',
    raisedAlt: isDark ? '#23232B' : '#F7F7FA',
    sunken: isDark ? '#0B0B0E' : '#EDEDF2',
    glass: withAlpha(isDark ? '#0C0C11' : '#FFFFFF', isDark ? 0.72 : 0.80),
    glassStrong: withAlpha(isDark ? '#111116' : '#FFFFFF', isDark ? 0.97 : 0.98),
    highlight: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.92)',
    highlightSoft: isDark
      ? 'rgba(255,255,255,0.07)'
      : 'rgba(255,255,255,0.58)',
    shadow: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)',
    shadowSoft: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.07)',
    ambientA: withAlpha(colors.primary, isDark ? 0.16 : 0.10),
    ambientB: withAlpha(colors.secondary, isDark ? 0.14 : 0.08),
  };
}
