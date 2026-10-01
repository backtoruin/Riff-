import React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@/src/lib/tabBarHeight";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Zap, Sparkles } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";
import { XPBar } from "@/src/components/XPBar";
import { StreakPill } from "@/src/components/StreakPill";
import { RiffMark } from "@/src/components/RiffMark";
import { LessonCard, Lesson } from "@/src/components/LessonCard";

type Progress = {
  xp: number;
  streak_days: number;
  completed_lessons: string[];
  level: number;
  xp_into_level: number;
  xp_to_next: number;
  earned_badges: string[];
};

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  stickyHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hiStack: { gap: 2 },
  hi: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "500", letterSpacing: 0.3 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg },
  heroCard: {
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroTitle: {
    color: colors.onBrandTertiary,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  heroSub: { color: colors.onSurfaceSecondary, fontSize: 13 },
  heroCta: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  heroCtaTxt: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1.4, fontWeight: "600" },
  statValue: {
    color: colors.onSurface,
    fontSize: 28,
    fontWeight: "500",
    marginTop: 4,
    letterSpacing: 0.5,
  },
  spinnerCenter: { alignItems: "center", padding: spacing.xl },
  nextRow: { gap: spacing.md },
}));

export default function HomeTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const bottomChrome = tabBarHeight;
  const router = useRouter();
  const { state } = useAuth();

  const progressQ = useQuery({
    queryKey: ["progress"],
    queryFn: () => apiFetch<Progress>("/api/me/progress"),
  });
  const lessonsQ = useQuery({
    queryKey: ["lessons"],
    queryFn: () => apiFetch<{ lessons: Lesson[] }>("/api/lessons"),
  });

  const user = state.status === "authenticated" ? state.user : null;
  const progress = progressQ.data;
  const completed = new Set(progress?.completed_lessons ?? []);
  const lessons = lessonsQ.data?.lessons ?? [];
  const nextLesson = lessons.find((l) => !completed.has(l.lesson_id)) ?? lessons[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.stickyHeader}>
        <View style={styles.headerTop}>
          <View style={styles.hiStack}>
            <Text style={styles.hi}>WELCOME BACK</Text>
            <Text style={styles.name} testID="home-user-name">
              {user?.name?.split(" ")[0] ?? "Player"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <StreakPill days={progress?.streak_days ?? 0} />
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar} />
            )}
          </View>
        </View>
        {progress && (
          <XPBar
            level={progress.level}
            xpInto={progress.xp_into_level}
            xpToNext={progress.xp_to_next}
          />
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomChrome + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — Ask Riff */}
        <View style={styles.heroCard} testID="home-ask-riff-card">
          <View style={styles.heroRow}>
            <RiffMark size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Riff is on standby.</Text>
              <Text style={styles.heroSub}>
                Hit the Studio to let me see & hear your playing — I'll call out exactly what to fix.
              </Text>
            </View>
          </View>
          <Pressable
            testID="home-start-studio-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              router.push("/(tabs)/studio");
            }}
            style={styles.heroCta}
          >
            <Text style={styles.heroCtaTxt}>START A LIVE SESSION</Text>
          </Pressable>
        </View>

        {/* Stats */}
        <Text style={styles.sectionTitle}>YOUR STATS</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard} testID="home-stat-xp">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Zap size={12} color={colors.brand} />
              <Text style={styles.statLabel}>TOTAL XP</Text>
            </View>
            <Text style={styles.statValue}>{progress?.xp ?? 0}</Text>
          </View>
          <View style={styles.statCard} testID="home-stat-badges">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Sparkles size={12} color={colors.brand} />
              <Text style={styles.statLabel}>BADGES</Text>
            </View>
            <Text style={styles.statValue}>{progress?.earned_badges?.length ?? 0}</Text>
          </View>
          <View style={styles.statCard} testID="home-stat-lessons">
            <Text style={styles.statLabel}>DONE</Text>
            <Text style={styles.statValue}>{progress?.completed_lessons?.length ?? 0}</Text>
          </View>
        </View>

        {/* Up Next */}
        <Text style={styles.sectionTitle}>UP NEXT ON YOUR PATH</Text>
        {lessonsQ.isLoading ? (
          <View style={styles.spinnerCenter}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : nextLesson ? (
          <LessonCard
            lesson={nextLesson}
            completed={completed.has(nextLesson.lesson_id)}
            onPress={() => router.push(`/lesson/${nextLesson.lesson_id}` as any)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
