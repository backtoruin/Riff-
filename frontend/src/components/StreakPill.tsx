import React from "react";
import { View, Text } from "react-native";
import { Flame } from "lucide-react-native";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandTertiary,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  count: {
    color: colors.onBrandTertiary,
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.4,
  },
}));

export function StreakPill({ days }: { days: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID="streak-pill">
      <Flame size={16} color={colors.brand} fill={colors.brand} />
      <Text style={styles.count}>{days}</Text>
    </View>
  );
}
