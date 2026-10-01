import React from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { CheckCircle2 } from "lucide-react-native";

export type Lesson = {
  lesson_id: string;
  title: string;
  subtitle: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | string;
  xp: number;
  duration_min: number;
  category: string;
  image_url: string;
  order: number;
};

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageWrap: { height: 160, position: "relative" },
  img: { width: "100%", height: "100%" },
  scrim: { ...Object.fromEntries(["top", "left", "right", "bottom"].map((k) => [k, 0])), position: "absolute" as const },
  topRow: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  xpTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: "#121212CC",
  },
  xpTxt: { color: colors.brand, fontSize: 12, fontWeight: "700" },
  body: { padding: spacing.lg, gap: 2 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "500", letterSpacing: 0.3 },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 2 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    alignItems: "center",
  },
  footTxt: { color: colors.muted, fontSize: 12, letterSpacing: 0.3 },
  check: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkTxt: { color: colors.success, fontSize: 12, fontWeight: "700" },
}));

function badgeStyle(colors: any, difficulty: string) {
  switch (difficulty) {
    case "Beginner":
      return { bg: colors.success + "22", border: colors.success, txt: colors.success };
    case "Intermediate":
      return { bg: colors.warning + "22", border: colors.warning, txt: colors.warning };
    case "Advanced":
      return { bg: colors.error + "22", border: colors.error, txt: colors.error };
    default:
      return { bg: colors.surfaceTertiary, border: colors.borderStrong, txt: colors.onSurfaceTertiary };
  }
}

export function LessonCard({
  lesson,
  completed,
  onPress,
}: {
  lesson: Lesson;
  completed?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const b = badgeStyle(colors, lesson.difficulty);
  return (
    <Pressable
      testID={`lesson-card-${lesson.lesson_id}`}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: lesson.image_url }} style={styles.img} contentFit="cover" />
        <LinearGradient
          colors={["#12121200", "#121212DD"]}
          style={styles.scrim}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.topRow}>
          <View
            style={[
              styles.badge,
              { backgroundColor: b.bg, borderColor: b.border },
            ]}
          >
            <Text style={[styles.badgeTxt, { color: b.txt }]}>
              {lesson.difficulty.toUpperCase()}
            </Text>
          </View>
          <View style={styles.xpTag}>
            <Text style={styles.xpTxt}>+{lesson.xp} XP</Text>
          </View>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{lesson.title}</Text>
        <Text style={styles.subtitle}>{lesson.subtitle}</Text>
        <View style={styles.footer}>
          <Text style={styles.footTxt}>
            {lesson.category} · {lesson.duration_min} min
          </Text>
          {completed && (
            <View style={styles.check}>
              <CheckCircle2 size={14} color={colors.success} />
              <Text style={styles.checkTxt}>DONE</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}
