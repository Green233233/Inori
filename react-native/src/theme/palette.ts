/**
 * Color schemes + surface tokens.
 *
 * Visual language: light neumorphism on warm paper with frosted-glass layers
 * and bold, warm contrasting color blocks (coral / tangerine / teal / mustard
 * / mulberry). Deliberately avoids the generic blue-purple "tech gradient"
 * look: every accent is warm or earthy, and dark themes stay cocoa/forest/plum
 * rather than navy.
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
  primary: '#D6435B',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFB3A7',
  onPrimaryContainer: '#5A1B18',
  secondary: '#F08A3C',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFD9A8',
  onSecondaryContainer: '#5A3410',
  tertiary: '#2A9D8F',
  onTertiary: '#FFFFFF',
  background: '#FBF3E7',
  onBackground: '#3A2A24',
  surface: '#FFFCF5',
  onSurface: '#3A2A24',
  surfaceVariant: '#F6E7D8',
  onSurfaceVariant: '#6F5348',
  outline: '#C7A38D',
  error: '#B3261E',
  onError: '#FFFFFF',
};

const SAKURA_DARK: ColorScheme = {
  primary: '#FF8B9B',
  onPrimary: '#3A0E16',
  primaryContainer: '#762A35',
  onPrimaryContainer: '#FFD5D8',
  secondary: '#FFB266',
  onSecondary: '#3A2008',
  secondaryContainer: '#5C3A1B',
  onSecondaryContainer: '#FFE3C4',
  tertiary: '#5FD0BE',
  onTertiary: '#0C2622',
  background: '#21141A',
  onBackground: '#FFE9E3',
  surface: '#2C1B22',
  onSurface: '#FFE9E3',
  surfaceVariant: '#3D2831',
  onSurfaceVariant: '#E6C8C2',
  outline: '#95756F',
  error: '#FFB4AB',
  onError: '#690005',
};

const MINT_LIGHT: ColorScheme = {
  primary: '#128F78',
  onPrimary: '#FFFFFF',
  primaryContainer: '#A9E8D1',
  onPrimaryContainer: '#063A2E',
  secondary: '#E4572E',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFD3BE',
  onSecondaryContainer: '#5C1F08',
  tertiary: '#F2B705',
  onTertiary: '#3A2A02',
  background: '#F6F3E6',
  onBackground: '#2A342E',
  surface: '#FFFDF4',
  onSurface: '#2A342E',
  surfaceVariant: '#E8EEDF',
  onSurfaceVariant: '#54655A',
  outline: '#9CAF9F',
  error: '#B3261E',
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
  background: '#12201B',
  onBackground: '#E6F5EC',
  surface: '#1B2C25',
  onSurface: '#E6F5EC',
  surfaceVariant: '#2A3D34',
  onSurfaceVariant: '#C6DED0',
  outline: '#7E9788',
  error: '#FFB4AB',
  onError: '#690005',
};

const PERIWINKLE_LIGHT: ColorScheme = {
  primary: '#8C3F63',
  onPrimary: '#FFFFFF',
  primaryContainer: '#F4B8D0',
  onPrimaryContainer: '#4E1630',
  secondary: '#2A9D8F',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#BDEBE2',
  onSecondaryContainer: '#083A34',
  tertiary: '#F2B705',
  onTertiary: '#3A2A02',
  background: '#F9F1EC',
  onBackground: '#382A33',
  surface: '#FFFBF7',
  onSurface: '#382A33',
  surfaceVariant: '#F1E2E8',
  onSurfaceVariant: '#6D5462',
  outline: '#B99AA8',
  error: '#B3261E',
  onError: '#FFFFFF',
};

const PERIWINKLE_DARK: ColorScheme = {
  primary: '#F2A9C6',
  onPrimary: '#3A0F22',
  primaryContainer: '#6B2A47',
  onPrimaryContainer: '#FFD6E5',
  secondary: '#6FE0C0',
  onSecondary: '#063028',
  secondaryContainer: '#1C5548',
  onSecondaryContainer: '#C9F7E8',
  tertiary: '#F2C94C',
  onTertiary: '#3A2A02',
  background: '#22141F',
  onBackground: '#FBE7EE',
  surface: '#2D1C28',
  onSurface: '#FBE7EE',
  surfaceVariant: '#3E2A37',
  onSurfaceVariant: '#E3C9D4',
  outline: '#997C8B',
  error: '#FFB4AB',
  onError: '#690005',
};

export const SCHEMES: Record<
  Exclude<ColorStyleName, 'SYSTEM'>,
  { light: ColorScheme; dark: ColorScheme }
> = {
  SAKURA: { light: SAKURA_LIGHT, dark: SAKURA_DARK },
  MINT: { light: MINT_LIGHT, dark: MINT_DARK },
  PERIWINKLE: { light: PERIWINKLE_LIGHT, dark: PERIWINKLE_DARK },
};

/** Bold, warm category accents used for solid color blocks. */
export const CATEGORY_ACCENT: Record<string, string> = {
  ALL: '#2A9D8F',
  DAILY: '#F2B705',
  WORK: '#E4572E',
  GOAL: '#128F78',
  INSPIRATION: '#D6435B',
  EMOTION: '#8C3F63',
};

/** Semantic accents. */
export const ACCENT = {
  favoriteRed: '#E4572E',
  starYellow: '#F2B705',
  fireOrange: '#FF8A3D',
  darkGrey: '#333333',
  white: '#FFFFFF',
};

export function resolveScheme(
  style: ColorStyleName,
  dark: boolean,
): ColorScheme {
  // "SYSTEM" style used Android 12 dynamic color; below API 31 it fell back to
  // Sakura, so the RN build consistently uses Sakura (documented deviation).
  const key = style === 'SYSTEM' ? 'SAKURA' : style;
  return SCHEMES[key][dark ? 'dark' : 'light'];
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Linear RGB mix (ratio = weight of `to`). */
export function mixColor(from: string, to: string, ratio: number): string {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  return `#${[r, g, b]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')}`;
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
  const raised = isDark
    ? mixColor(colors.surface, '#FFFFFF', 0.06)
    : mixColor(colors.background, '#FFFFFF', 0.82);
  const raisedAlt = isDark
    ? mixColor(colors.surface, '#000000', 0.14)
    : mixColor(colors.surfaceVariant, '#FFFFFF', 0.55);
  const sunken = isDark
    ? mixColor(colors.background, '#000000', 0.24)
    : mixColor(colors.background, '#8C5A48', 0.10);
  return {
    raised,
    raisedAlt,
    sunken,
    glass: withAlpha(
      mixColor(colors.surface, colors.primary, isDark ? 0.06 : 0.035),
      isDark ? 0.66 : 0.56,
    ),
    glassStrong: withAlpha(
      mixColor(colors.surface, colors.primary, isDark ? 0.04 : 0.02),
      isDark ? 0.94 : 0.92,
    ),
    highlight: isDark ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.94)',
    highlightSoft: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.58)',
    shadow: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(120,78,62,0.22)',
    shadowSoft: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(120,78,62,0.10)',
    ambientA: withAlpha(colors.primary, isDark ? 0.18 : 0.14),
    ambientB: withAlpha(colors.secondary, isDark ? 0.16 : 0.11),
  };
}
