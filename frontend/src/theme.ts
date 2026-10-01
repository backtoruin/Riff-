// RiffMaster — Dark-first utility palette with Signal Orange accents.
// Keys match /app/design_guidelines.json. Dark-only theme.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  // Surfaces
  surface: "#121212",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1E1E1E",
  onSurfaceSecondary: "#E0E0E0",
  surfaceTertiary: "#2C2C2C",
  onSurfaceTertiary: "#B3B3B3",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#121212",
  muted: "#888888",

  // Brand — Signal Orange
  brand: "#FF6B00",
  onBrand: "#000000",
  brandPrimary: "#FF6B00",
  onBrandPrimary: "#000000",
  brandSecondary: "#CC5500",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#331600",
  onBrandTertiary: "#FF8C33",

  // Status
  success: "#00C853",
  onSuccess: "#000000",
  warning: "#FFAB00",
  onWarning: "#000000",
  error: "#D50000",
  onError: "#FFFFFF",
  info: "#2A2A2A",
  onInfo: "#E0E0E0",

  // Lines
  border: "#2C2C2C",
  borderStrong: "#3A3A3A",
  divider: "#2A2A2A",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.light ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme =
    system && (themes as any)[system] ? (system as ColorScheme) : defaultScheme;
  return { scheme, colors: (themes as any)[scheme] ?? themes.dark };
}

export function makeStyles<
  T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>
>(factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Spacing + radius tokens from design_guidelines
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
};

export const fontFamily = {
  display: "Barlow Condensed",
  text: "Satoshi",
};
