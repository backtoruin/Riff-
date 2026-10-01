import React from "react";
import { View, Text, FlatList, ActivityIndicator, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@/src/lib/tabBarHeight";

import { apiFetch } from "@/src/api/client";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";
import { LessonCard, Lesson } from "@/src/components/LessonCard";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kicker: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "500", letterSpacing: 0.3 },
  chipsRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  chipTxt: { color: colors.onSurfaceTertiary, fontWeight: "700", letterSpacing: 0.5, fontSize: 12 },
  chipTxtActive: { color: colors.brand },
  spinnerCenter: { padding: spacing.xl, alignItems: "center" },
  listGap: { height: spacing.md },
}));

const DIFFICULTIES = ["All", "Beginner", "Intermediate", "Advanced"];

export default function LessonsTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const [filter, setFilter] = React.useState("All");

  const lessonsQ = useQuery({
    queryKey: ["lessons"],
    queryFn: () => apiFetch<{ lessons: Lesson[] }>("/api/lessons"),
  });
  const progressQ = useQuery({
    queryKey: ["progress"],
    queryFn: () => apiFetch<{ completed_lessons: string[] }>("/api/me/progress"),
  });

  const completed = new Set(progressQ.data?.completed_lessons ?? []);
  const all = lessonsQ.data?.lessons ?? [];
  const list = filter === "All" ? all : all.filter((l) => l.difficulty === filter);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.kicker}>LIBRARY</Text>
        <Text style={styles.title}>Lessons</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={{ flexGrow: 0, height: 56 }}
      >
        {DIFFICULTIES.map((d) => (
          <View
            key={d}
            testID={`filter-chip-${d}`}
            style={[styles.chip, filter === d && styles.chipActive]}
            onTouchEnd={() => setFilter(d)}
          >
            <Text style={[styles.chipTxt, filter === d && styles.chipTxtActive]}>
              {d.toUpperCase()}
            </Text>
          </View>
        ))}
      </ScrollView>

      {lessonsQ.isLoading ? (
        <View style={styles.spinnerCenter}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(l) => l.lesson_id}
          renderItem={({ item }) => (
            <LessonCard
              lesson={item}
              completed={completed.has(item.lesson_id)}
              onPress={() => router.push(`/lesson/${item.lesson_id}` as any)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.listGap} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: tabBarHeight + spacing.xxl,
          }}
        />
      )}
    </View>
  );
}
