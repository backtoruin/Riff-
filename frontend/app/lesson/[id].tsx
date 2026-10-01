import React from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, Zap, CheckCircle2, Flame } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import { apiFetch } from "@/src/api/client";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";

type Lesson = {
  lesson_id: string;
  title: string;
  subtitle: string;
  difficulty: string;
  xp: number;
  duration_min: number;
  category: string;
  image_url: string;
  content: string;
};

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 240, position: "relative" },
  heroImg: { width: "100%", height: "100%" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  back: {
    position: "absolute",
    top: 10,
    left: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#121212CC",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCaption: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    gap: 6,
  },
  category: { color: colors.brand, fontSize: 12, letterSpacing: 1.5, fontWeight: "700" },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "500", letterSpacing: 0.3 },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 14 },
  metaRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaTxt: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  content: { padding: spacing.lg, gap: spacing.lg },
  body: { color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 24 },
  completeBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
  },
  completeTxt: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 14,
  },
  doneBanner: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.success + "22",
    borderWidth: 1,
    borderColor: colors.success,
    alignItems: "center",
    gap: 4,
  },
  doneTitle: { color: colors.success, fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },
  doneSub: { color: colors.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  center: { padding: spacing.xl, alignItems: "center" },
}));

export default function LessonDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [justEarned, setJustEarned] = React.useState<null | {
    xp_gained: number;
    streak_days: number;
    streak_bumped: boolean;
    new_badges: string[];
  }>(null);

  const lessonQ = useQuery({
    queryKey: ["lesson", id],
    queryFn: () => apiFetch<Lesson>(`/api/lessons/${id}`),
    enabled: !!id,
  });
  const progressQ = useQuery({
    queryKey: ["progress"],
    queryFn: () => apiFetch<{ completed_lessons: string[] }>("/api/me/progress"),
  });

  const completeMut = useMutation({
    mutationFn: () =>
      apiFetch<{
        xp_gained: number;
        streak_days: number;
        streak_bumped: boolean;
        new_badges: string[];
      }>("/api/me/complete-lesson", {
        method: "POST",
        body: JSON.stringify({ lesson_id: id, score: 100 }),
      }),
    onSuccess: (data) => {
      setJustEarned(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  const alreadyDone = new Set(progressQ.data?.completed_lessons ?? []).has(id as string);
  const lesson = lessonQ.data;

  return (
    <View style={styles.root} testID="lesson-detail-screen">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {lesson?.image_url ? (
            <Image source={{ uri: lesson.image_url }} style={styles.heroImg} contentFit="cover" />
          ) : null}
          <LinearGradient
            colors={["#12121266", "#121212EE"]}
            style={styles.scrim}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
          <Pressable
            testID="lesson-back-button"
            style={[styles.back, { top: insets.top + 10 }]}
            onPress={() => router.back()}
          >
            <ChevronLeft size={22} color={colors.onSurface} />
          </Pressable>
          {lesson && (
            <View style={styles.heroCaption}>
              <Text style={styles.category}>{lesson.category.toUpperCase()}</Text>
              <Text style={styles.title}>{lesson.title}</Text>
              <Text style={styles.subtitle}>{lesson.subtitle}</Text>
            </View>
          )}
        </View>

        {lesson ? (
          <>
            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Zap size={12} color={colors.brand} />
                <Text style={styles.metaTxt}>+{lesson.xp} XP</Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaTxt}>{lesson.difficulty}</Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaTxt}>{lesson.duration_min} min</Text>
              </View>
            </View>

            <View style={styles.content}>
              <Text style={styles.body}>{lesson.content}</Text>

              {alreadyDone && !justEarned ? (
                <View style={styles.doneBanner}>
                  <CheckCircle2 size={28} color={colors.success} />
                  <Text style={styles.doneTitle}>LESSON COMPLETE</Text>
                  <Text style={styles.doneSub}>
                    Replay it anytime for a small XP boost.
                  </Text>
                </View>
              ) : null}

              {justEarned ? (
                <View style={styles.doneBanner}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Zap size={22} color={colors.success} />
                    {justEarned.streak_bumped && <Flame size={22} color={colors.brand} />}
                  </View>
                  <Text style={styles.doneTitle}>
                    +{justEarned.xp_gained} XP · {justEarned.streak_days}-DAY STREAK
                  </Text>
                  {justEarned.new_badges.length > 0 && (
                    <Text style={styles.doneSub}>
                      New badge unlocked: {justEarned.new_badges.join(", ")}
                    </Text>
                  )}
                </View>
              ) : (
                <Pressable
                  testID="lesson-complete-button"
                  disabled={completeMut.isPending}
                  onPress={() => completeMut.mutate()}
                  style={[
                    styles.completeBtn,
                    completeMut.isPending && { opacity: 0.6 },
                  ]}
                >
                  {completeMut.isPending ? (
                    <ActivityIndicator color={colors.onBrandPrimary} />
                  ) : (
                    <>
                      <CheckCircle2 size={18} color={colors.onBrandPrimary} />
                      <Text style={styles.completeTxt}>
                        {alreadyDone ? "REPLAY & EARN XP" : "MARK AS COMPLETE"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
