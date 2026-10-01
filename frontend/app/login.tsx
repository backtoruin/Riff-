import React from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { RiffMark } from "@/src/components/RiffMark";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  mark: { marginBottom: spacing.xl },
  title: {
    color: colors.onSurface,
    fontSize: 36,
    fontWeight: "500",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  brand: { color: colors.brand },
  tagline: {
    color: colors.onSurfaceTertiary,
    fontSize: 16,
    textAlign: "center",
    marginBottom: spacing.xxxl,
    maxWidth: 320,
  },
  cta: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 260,
    justifyContent: "center",
  },
  ctaText: {
    color: colors.onBrandPrimary,
    fontSize: 16,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  gLogoWrap: {
    width: 24,
    height: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  gLogoTxt: { color: "#4285F4", fontWeight: "700", fontSize: 14 },
  busy: { marginTop: spacing.lg },
}));

export default function Login() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signInWithGoogle, state } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (state.status === "authenticated") router.replace("/(tabs)");
  }, [state.status, router]);

  const onSignIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <RiffMark size={96} />
        </View>
        <Text style={styles.title}>
          RIFF<Text style={styles.brand}>MASTER</Text>
        </Text>
        <Text style={styles.tagline}>
          Your personal AI guitar teacher. Camera, audio & MIDI feedback that feels human.
        </Text>

        <Pressable
          testID="google-signin-button"
          onPress={onSignIn}
          disabled={busy}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
        >
          <View style={styles.gLogoWrap}>
            <Text style={styles.gLogoTxt}>G</Text>
          </View>
          <Text style={styles.ctaText}>
            {busy ? "Signing you in…" : "Continue with Google"}
          </Text>
        </Pressable>
        {busy && <ActivityIndicator style={styles.busy} color={colors.brand} />}
      </View>
      <Text style={styles.footer}>
        By continuing, you agree to let Riff see & hear your playing to give feedback.
      </Text>
    </View>
  );
}
