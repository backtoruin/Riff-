import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Volume2 } from "lucide-react-native";

import { apiFetch, BACKEND_URL, getToken } from "@/src/api/client";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

type Voice = { id: string; label: string };
type Model = { id: string; label: string; steerable: boolean; description: string };
type VoiceData = {
  models: Model[];
  voices: Voice[];
  extra_voices: Voice[];
  current: { voice: string; model: string; instructions: string | null };
};

const useStyles = makeStyles((colors) => ({
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 1,
  },
  sub: { color: colors.muted, fontSize: 12 },
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
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
  chipTxt: { color: colors.onSurfaceTertiary, fontWeight: "700", letterSpacing: 0.5, fontSize: 11 },
  chipTxtActive: { color: colors.brand },

  previewBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  previewTxt: { color: colors.onBrandPrimary, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
}));

export function VoicePicker() {
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const audioRef = useRef<any>(null);
  const [previewing, setPreviewing] = useState(false);

  const voicesQ = useQuery({
    queryKey: ["tts-voices"],
    queryFn: () => apiFetch<VoiceData>("/api/tts/voices"),
  });

  const setMut = useMutation({
    mutationFn: (payload: { voice?: string; model?: string }) =>
      apiFetch("/api/me/tts-voice", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tts-voices"] }),
  });

  const data = voicesQ.data;
  const current = data?.current;
  const steerable = data?.models.find((m) => m.id === current?.model)?.steerable;
  const allVoices = [
    ...(data?.voices ?? []),
    ...((steerable ? data?.extra_voices : []) ?? []),
  ];

  const stopPreview = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      if (Platform.OS === "web") { a.pause?.(); try { a.src = ""; } catch {} }
      else { a.pause?.(); a.remove?.(); }
    } catch {}
    audioRef.current = null;
  };

  const preview = useCallback(async () => {
    if (!current) return;
    setPreviewing(true);
    stopPreview();
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND_URL}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          text: "Hey — I'm Riff. Let's warm those fingers up and make some noise.",
          voice: current.voice,
          model: current.model,
        }),
      });
      if (!res.ok) return;
      const d = await res.json();
      const url = `${BACKEND_URL}${d.url}`;
      if (Platform.OS === "web") {
        const a = new (globalThis as any).Audio(url);
        audioRef.current = a;
        a.onended = () => { if (audioRef.current === a) audioRef.current = null; };
        await a.play();
      } else {
        const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
        try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false } as any); } catch {}
        const p = createAudioPlayer({ uri: url });
        audioRef.current = p;
        p.play();
      }
    } finally {
      setPreviewing(false);
    }
  }, [current]);

  if (!data) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RIFF'S VOICE</Text>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.section} testID="voice-picker">
      <Text style={styles.sectionTitle}>RIFF'S VOICE</Text>
      <Text style={styles.sub}>Emergent-managed OpenAI TTS. Pick a voice + model.</Text>

      <Text style={[styles.sub, { marginTop: spacing.sm }]}>MODEL</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {data.models.map((m) => (
          <Pressable
            key={m.id}
            testID={`voice-model-${m.id}`}
            onPress={() => setMut.mutate({ model: m.id })}
            style={[styles.chip, current?.model === m.id && styles.chipActive]}
          >
            <Text style={[styles.chipTxt, current?.model === m.id && styles.chipTxtActive]}>
              {m.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={[styles.sub, { marginTop: spacing.xs }]}>VOICE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {allVoices.map((v) => (
          <Pressable
            key={v.id}
            testID={`voice-${v.id}`}
            onPress={() => setMut.mutate({ voice: v.id })}
            style={[styles.chip, current?.voice === v.id && styles.chipActive]}
          >
            <Text style={[styles.chipTxt, current?.voice === v.id && styles.chipTxtActive]}>
              {v.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable
        testID="voice-preview-button"
        onPress={preview}
        disabled={previewing}
        style={[styles.previewBtn, previewing && { opacity: 0.6 }]}
      >
        <Volume2 size={14} color={colors.onBrandPrimary} />
        <Text style={styles.previewTxt}>{previewing ? "LOADING…" : "PREVIEW"}</Text>
      </Pressable>
    </View>
  );
}
