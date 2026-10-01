import React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@/src/lib/tabBarHeight";
import { Image } from "expo-image";
import { LogOut, Award, Flame, Zap, Target } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";

type BadgeRef = { id: string; name: string; description: string; earned: boolean };
type Progress = {
  xp: number;
  streak_days: number;
  level: number;
  xp_into_level: number;
  xp_to_next: number;
  completed_lessons: string[];
  sessions_count: number;
  earned_badges: string[];
  badges: BadgeRef[];
};

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatarWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.brand },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  name: { color: colors.onSurface, fontSize: 20, fontWeight: "500" },
  email: { color: colors.muted, fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg },
  statsGrid: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  statCard: {
    width: "48%",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.3,
    fontWeight: "600",
  },
  statRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statValue: { color: colors.onSurface, fontSize: 32, fontWeight: "500", letterSpacing: 0.3 },
  sectionTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600", letterSpacing: 1 },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  badgeCard: {
    width: "47%",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: 6,
  },
  badgeCardEarned: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  badgeIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  badgeIconEarned: { backgroundColor: colors.brand },
  badgeName: { color: colors.onSurface, fontSize: 13, fontWeight: "600", textAlign: "center" },
  badgeNameLocked: { color: colors.muted },
  badgeDesc: { color: colors.muted, fontSize: 11, textAlign: "center" },
  logoutBtn: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  logoutTxt: { color: colors.error, fontWeight: "700", letterSpacing: 1 },
}));

export default function ProfileTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { state, signOut } = useAuth();
  const qc = useQueryClient();

  const progressQ = useQuery({
    queryKey: ["progress"],
    queryFn: () => apiFetch<Progress>("/api/me/progress"),
  });

  const user = state.status === "authenticated" ? state.user : null;
  const p = progressQ.data;

  const onLogout = async () => {
    await signOut();
    qc.clear();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} testID="profile-name">{user?.name ?? "Player"}</Text>
          <Text style={styles.email}>{user?.email ?? ""}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: tabBarHeight + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {progressQ.isLoading || !p ? (
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <View style={styles.statRow}>
                  <Zap size={12} color={colors.brand} />
                  <Text style={styles.statLabel}>TOTAL XP</Text>
                </View>
                <Text style={styles.statValue}>{p.xp}</Text>
              </View>
              <View style={styles.statCard}>
                <View style={styles.statRow}>
                  <Flame size={12} color={colors.brand} />
                  <Text style={styles.statLabel}>STREAK</Text>
                </View>
                <Text style={styles.statValue}>{p.streak_days}d</Text>
              </View>
              <View style={styles.statCard}>
                <View style={styles.statRow}>
                  <Target size={12} color={colors.brand} />
                  <Text style={styles.statLabel}>LESSONS DONE</Text>
                </View>
                <Text style={styles.statValue}>{p.completed_lessons.length}</Text>
              </View>
              <View style={styles.statCard}>
                <View style={styles.statRow}>
                  <Award size={12} color={colors.brand} />
                  <Text style={styles.statLabel}>SESSIONS</Text>
                </View>
                <Text style={styles.statValue}>{p.sessions_count}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>BADGES</Text>
            <View style={styles.badgeGrid}>
              {p.badges.map((b) => (
                <View
                  key={b.id}
                  testID={`badge-${b.id}`}
                  style={[styles.badgeCard, b.earned && styles.badgeCardEarned]}
                >
                  <View style={[styles.badgeIcon, b.earned && styles.badgeIconEarned]}>
                    <Award size={24} color={b.earned ? colors.onBrand : colors.muted} />
                  </View>
                  <Text style={[styles.badgeName, !b.earned && styles.badgeNameLocked]}>
                    {b.name}
                  </Text>
                  <Text style={styles.badgeDesc}>{b.description}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Pressable testID="logout-button" onPress={onLogout} style={styles.logoutBtn}>
          <LogOut size={16} color={colors.error} />
          <Text style={styles.logoutTxt}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
