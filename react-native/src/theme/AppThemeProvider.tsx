import React, {createContext, useContext, useMemo} from 'react';
import {useColorScheme} from 'react-native';
import {
  ColorScheme,
  ColorStyleName,
  SurfaceTokens,
  ThemeModeName,
  buildSurfaces,
  resolveScheme,
} from './palette';
import {WindowTokens, useWindowTokens} from './window';

export interface AppTheme {
  colors: ColorScheme;
  surfaces: SurfaceTokens;
  isDark: boolean;
  colorStyle: ColorStyleName;
  themeMode: ThemeModeName;
  tokens: WindowTokens;
}

const ThemeContext = createContext<AppTheme | null>(null);

export function AppThemeProvider({
  colorStyle,
  themeMode,
  children,
}: {
  colorStyle: ColorStyleName;
  themeMode: ThemeModeName;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const isDark =
    themeMode === 'DARK' || (themeMode === 'SYSTEM' && system === 'dark');
  const tokens = useWindowTokens();
  const colors = resolveScheme(colorStyle, isDark);
  const surfaces = useMemo(
    () => buildSurfaces(colors, isDark),
    [colors, isDark],
  );
  const value = useMemo<AppTheme>(
    () => ({colors, surfaces, isDark, colorStyle, themeMode, tokens}),
    [colors, surfaces, isDark, colorStyle, themeMode, tokens],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used inside AppThemeProvider');
  }
  return ctx;
}
