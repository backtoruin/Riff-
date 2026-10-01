import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, Minus, Plus } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import { apiFetch, BACKEND_URL, getToken } from "@/src/api/client";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

type Pattern = { id: string; label: string; beats_per_bar: number };

const useStyles = makeStyles((colors) => ({
  panel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },

  bpmRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  bpmStepper: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  bpmValue: {
    color: colors.onSurface,
    fontSize: 44,
    fontWeight: "500",
    letterSpacing: 1,
    minWidth: 100,
    textAlign: "center",
  },
  bpmUnit: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, marginTop: -4 },

  chipsRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  chipTxt: { color: colors.onSurfaceTertiary, fontWeight: "700", letterSpacing: 0.5, fontSize: 11 },
  chipTxtActive: { color: colors.brand },

  barsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  playBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  playBtnStop: { backgroundColor: colors.error },
  playTxt: { color: colors.onBrandPrimary, fontWeight: "700", letterSpacing: 1, fontSize: 13 },

  pulseWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.border,
  },
  pulseActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  pulseNum: { color: colors.onSurface, fontSize: 24, fontWeight: "700" },
  pulseNumActive: { color: colors.brand },
}));

export function RhythmCoach() {
  const styles = useStyles();
  const { colors } = useTheme();

  const [bpm, setBpm] = useState(90);
  const [patternId, setPatternId] = useState("eighths");
  const [bars, setBars] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [beat, setBeat] = useState(0);

  const audioRef = useRef<any>(null);
  const beatTimerRef = useRef<any>(null);

  const patternsQ = useQuery({
    queryKey: ["metronome-patterns"],
    queryFn: () =>
      apiFetch<{ patterns: Pattern[] }>("/api/metronome/patterns"),
  });
  const patterns = patternsQ.data?.patterns ?? [];
  const currentPattern = patterns.find((p) => p.id === patternId);
  const beatsPerBar = currentPattern?.beats_per_bar ?? 4;

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        if (Platform.OS === "web") {
          a.pause?.();
          try { a.src = ""; } catch {}
        } else {
          a.pause?.();
          a.remove?.();
        }
      } catch {}
      audioRef.current = null;
    }
    if (beatTimerRef.current) {
      clearInterval(beatTimerRef.current);
      beatTimerRef.current = null;
    }
    setPlaying(false);
    setBeat(0);
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const play = useCallback(async () => {
    if (playing) {
      stop();
      return;
    }
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND_URL}/api/metronome`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ bpm, pattern: patternId, bars }),
      });
      if (!res.ok) throw new Error("gen_failed");
      const data = await res.json();
      const audioUrl = `${BACKEND_URL}${data.url}`;

      // Visual beat pulse (independent interval starting now)
      const beatMs = 60000 / bpm;
      const totalBeats = data.total_beats as number;
      let b = 0;
      setBeat(0);
      setPlaying(true);
      beatTimerRef.current = setInterval(() => {
        b += 1;
        if (b >= totalBeats) {
          clearInterval(beatTimerRef.current);
          beatTimerRef.current = null;
        }
        setBeat(b);
      }, beatMs);

      if (Platform.OS === "web") {
        const a = new (globalThis as any).Audio(audioUrl);
        audioRef.current = a;
        a.onended = () => stop();
        a.onerror = () => stop();
        await a.play();
      } else {
        const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
        try {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false } as any);
        } catch {}
        const player = createAudioPlayer({ uri: audioUrl });
        audioRef.current = player;
        player.play();
        // Native: schedule a stop at the end based on duration from response
        setTimeout(() => stop(), (data.duration_s * 1000) + 800);
      }
    } catch (e) {
      stop();
    } finally {
      setLoading(false);
    }
  }, [bpm, patternId, bars, playing, stop]);

  // Current beat index within the bar (1..beatsPerBar), 0 when idle
  const beatInBar = playing && beat < bars * beatsPerBar
    ? (beat % beatsPerBar) + 1
    : 0;

  const nudgeBpm = (delta: number) => {
    setBpm((b) => Math.max(40, Math.min(220, b + delta)));
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <View style={styles.panel} testID="rhythm-coach-panel">
      <Text style={styles.label}>RHYTHM COACH · RIFF COUNTS IN TIME</Text>

      <View style={styles.bpmRow}>
        <Pressable
          testID="bpm-decrement"
          onPress={() => nudgeBpm(-5)}
          onLongPress={() => nudgeBpm(-20)}
          style={styles.bpmStepper}
        >
          <Minus size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.bpmValue} testID="bpm-value">{bpm}</Text>
          <Text style={styles.bpmUnit}>BPM</Text>
        </View>
        <Pressable
          testID="bpm-increment"
          onPress={() => nudgeBpm(5)}
          onLongPress={() => nudgeBpm(20)}
          style={styles.bpmStepper}
        >
          <Plus size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {patterns.map((p) => (
          <Pressable
            key={p.id}
            testID={`rhythm-pattern-${p.id}`}
            onPress={() => setPatternId(p.id)}
            style={[styles.chip, patternId === p.id && styles.chipActive]}
          >
            <Text style={[styles.chipTxt, patternId === p.id && styles.chipTxtActive]}>
              {p.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.barsRow}>
        {[1, 2, 4].map((n) => (
          <Pressable
            key={n}
            testID={`rhythm-bars-${n}`}
            onPress={() => setBars(n)}
            style={[styles.chip, bars === n && styles.chipActive, { flex: 1 }]}
          >
            <Text style={[styles.chipTxt, bars === n && styles.chipTxtActive]}>
              {n} {n === 1 ? "BAR" : "BARS"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.controls}>
        <Pressable
          testID="rhythm-play-button"
          onPress={play}
          disabled={loading}
          style={[
            styles.playBtn,
            playing && styles.playBtnStop,
            loading && { opacity: 0.6 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : playing ? (
            <>
              <Pause size={16} color={colors.onBrandPrimary} fill={colors.onBrandPrimary} />
              <Text style={styles.playTxt}>STOP</Text>
            </>
          ) : (
            <>
              <Play size={16} color={colors.onBrandPrimary} fill={colors.onBrandPrimary} />
              <Text style={styles.playTxt}>COUNT WITH ME</Text>
            </>
          )}
        </Pressable>
        <View
          style={[
            styles.pulseWrap,
            beatInBar > 0 && styles.pulseActive,
          ]}
        >
          <Text
            style={[
              styles.pulseNum,
              beatInBar > 0 && styles.pulseNumActive,
            ]}
          >
            {beatInBar > 0 ? beatInBar : "·"}
          </Text>
        </View>
      </View>
    </View>
  );
}
