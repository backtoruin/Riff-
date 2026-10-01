import React from "react";
import { View, Text } from "react-native";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  noteRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  note: {
    color: colors.onSurface,
    fontSize: 48,
    fontWeight: "500",
    letterSpacing: 2,
    minWidth: 90,
  },
  freq: { color: colors.onSurfaceTertiary, fontSize: 14 },
  tunerTrack: {
    marginTop: spacing.sm,
    height: 8,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    overflow: "hidden",
    flexDirection: "row",
  },
  tunerCenter: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.brand,
  },
  tunerDot: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 999,
  },
  cents: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  loudness: {
    marginTop: spacing.md,
    height: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  loudnessFill: { height: "100%", backgroundColor: colors.success },
  silent: { color: colors.muted, fontSize: 14 },
}));

export function PitchMeter({
  note,
  frequency,
  cents,
  rms,
  listening,
}: {
  note: string | null;
  frequency: number | null;
  cents: number;
  rms: number;
  listening: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const left = `${50 + (cents / 50) * 50}%`;
  const inTune = Math.abs(cents) < 10;
  const dotColor = inTune ? colors.success : Math.abs(cents) > 25 ? colors.error : colors.warning;

  return (
    <View style={styles.wrap} testID="pitch-meter">
      <Text style={styles.label}>{listening ? "LIVE PITCH" : "PITCH DETECTION"}</Text>
      <View style={styles.noteRow}>
        <Text style={styles.note}>{note ?? "—"}</Text>
        <Text style={styles.freq}>
          {frequency ? `${frequency.toFixed(1)} Hz` : (listening ? "listening…" : "mic off")}
        </Text>
      </View>
      <View style={styles.tunerTrack}>
        <View style={styles.tunerCenter} />
        {note && (
          <View
            style={[
              styles.tunerDot,
              { left: left as any, backgroundColor: dotColor },
            ]}
          />
        )}
      </View>
      <Text style={styles.cents}>
        {note ? (cents >= 0 ? `+${cents}` : cents) + " cents" : (listening ? "play a note" : "")}
      </Text>
      <View style={styles.loudness}>
        <View style={[styles.loudnessFill, { width: `${Math.min(100, rms * 300)}%` }]} />
      </View>
    </View>
  );
}
