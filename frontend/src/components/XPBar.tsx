import React from "react";
import { View, Text } from "react-native";
import { makeStyles, spacing, radius } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  wrap: { gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  xp: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  xpBrand: { color: colors.brand, fontWeight: "700" },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
  },
}));

export function XPBar({
  level,
  xpInto,
  xpToNext,
}: {
  level: number;
  xpInto: number;
  xpToNext: number;
}) {
  const styles = useStyles();
  const pct = Math.max(0, Math.min(100, (xpInto / Math.max(1, xpToNext)) * 100));
  return (
    <View style={styles.wrap} testID="xp-bar">
      <View style={styles.row}>
        <Text style={styles.label}>LEVEL {level}</Text>
        <Text style={styles.xp}>
          <Text style={styles.xpBrand}>{xpInto}</Text> / {xpToNext} XP
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}
