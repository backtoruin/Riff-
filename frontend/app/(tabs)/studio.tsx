import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@/src/lib/tabBarHeight";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import {
  Camera,
  Mic,
  Send,
  Volume2,
  CircleDot,
  Image as ImageIcon,
  Music,
  Upload,
} from "lucide-react-native";

import { apiFetch, BACKEND_URL, getToken } from "@/src/api/client";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";
import { RiffMark } from "@/src/components/RiffMark";
import { ChatBubble, ChatMessage } from "@/src/components/ChatBubble";
import { PitchMeter } from "@/src/components/PitchMeter";
import { RhythmCoach } from "@/src/components/RhythmCoach";
import { startPitchDetection, PitchState } from "@/src/lib/pitch";
import { startMidi, MidiState } from "@/src/lib/midi";
import { recordWebClip, recordNativeClip } from "@/src/lib/record";
import { pickMediaForUpload } from "@/src/lib/upload";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerStack: { flex: 1 },
  kicker: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "500", letterSpacing: 0.3 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  gear: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.sm,
    rowGap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  gearBtn: {
    flexBasis: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  gearBtnActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  gearTxt: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  gearTxtActive: { color: colors.brand },

  // CAMERA panel
  camPanel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  camPreview: {
    height: 170,
    position: "relative",
    backgroundColor: colors.surfaceTertiary,
  },
  camPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  camPlaceholderTxt: { color: colors.muted, fontSize: 12 },
  liveTag: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#121212CC",
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveTxt: { color: colors.onSurface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },

  // LISTEN panel
  listenPanel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },

  // Big primary action
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryTxt: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 13,
  },

  // RECORD BUTTON for audio
  recBtn: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.brandPrimary,
  },
  recBtnRecording: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  recTxt: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 13,
  },

  // MIDI panel
  midiPanel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  midiLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  midiRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  midiPill: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
  },
  midiPillTxt: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  midiEmpty: { color: colors.muted, fontSize: 12, fontStyle: "italic" },

  // Chat
  chat: { flex: 1 },
  chatContent: { paddingVertical: spacing.md, gap: 0 },

  // Thinking indicator
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  thinkingTxt: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // Input
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: 15,
  },
  send: {
    width: 44,
    height: 44,
    backgroundColor: colors.brandPrimary,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  listenHintBtn: {
    marginLeft: 4,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  listenTxt: { color: colors.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
}));

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Hey — I'm Riff. Flip on CAMERA and tap SNAP PHOTO so I can see your technique, or hit LISTEN and tap RECORD so I can hear you play. What are we working on today?",
};

export default function StudioTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const qc = useQueryClient();

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [rhythmOn, setRhythmOn] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recCountdown, setRecCountdown] = useState(0);
  const [midi, setMidi] = useState<MidiState>({ supported: false, devices: [], events: [] });
  const [pitch, setPitch] = useState<PitchState>({
    frequency: null,
    note: null,
    cents: 0,
    rms: 0,
  });

  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const scrollRef = useRef<ScrollView | null>(null);
  const pitchStopRef = useRef<null | (() => void)>(null);
  const midiStopRef = useRef<null | (() => void)>(null);
  // Single-slot audio player. Any new play must stop whatever is here first.
  const currentAudioRef = useRef<any>(null);
  const playingMsgIdRef = useRef<string | null>(null);
  const playTokenRef = useRef(0);
  const sessionLogged = useRef(false);

  // Native recorder (ignored on web)
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Pitch sample history for context
  const pitchSamplesRef = useRef<{ t: number; note: string }[]>([]);
  const pitchT0Ref = useRef<number>(0);

  // Load prior chat history
  const historyQ = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => apiFetch<{ messages: ChatMessage[] }>("/api/chat/history"),
  });
  useEffect(() => {
    if (historyQ.data?.messages?.length) {
      setMessages([WELCOME, ...historyQ.data.messages]);
    }
  }, [historyQ.data?.messages]);

  // Pitch + MIDI start/stop
  const onPitchUpdate = useCallback((s: PitchState) => {
    setPitch(s);
    if (s.note) {
      const t = (Date.now() - pitchT0Ref.current) / 1000;
      const arr = pitchSamplesRef.current;
      const last = arr[arr.length - 1];
      if (!last || last.note !== s.note) {
        arr.push({ t: Math.round(t * 10) / 10, note: s.note });
        if (arr.length > 60) arr.shift();
      }
    }
  }, []);

  const toggleListening = useCallback(async () => {
    if (listening) {
      pitchStopRef.current?.();
      midiStopRef.current?.();
      pitchStopRef.current = null;
      midiStopRef.current = null;
      setListening(false);
      setPitch({ frequency: null, note: null, cents: 0, rms: 0 });
      pitchSamplesRef.current = [];
      return;
    }
    setListening(true);
    pitchT0Ref.current = Date.now();
    pitchSamplesRef.current = [];
    pitchStopRef.current = await startPitchDetection(onPitchUpdate);
    midiStopRef.current = await startMidi(setMidi);
  }, [listening, onPitchUpdate]);

  useEffect(() => {
    return () => {
      pitchStopRef.current?.();
      midiStopRef.current?.();
      stopCurrentAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log a session when leaving (only once)
  useEffect(() => {
    return () => {
      if (!sessionLogged.current) {
        sessionLogged.current = true;
        apiFetch("/api/me/log-session", { method: "POST" }).catch(() => {});
      }
    };
  }, []);

  const toggleCamera = useCallback(async () => {
    if (!cameraOn) {
      if (!permission?.granted) {
        const r = await requestPermission();
        if (!r.granted) return;
      }
      setCameraOn(true);
    } else {
      setCameraOn(false);
    }
  }, [cameraOn, permission, requestPermission]);

  const scrollToEnd = () => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  };

  const stopCurrentAudio = useCallback(() => {
    const a = currentAudioRef.current;
    if (!a) return;
    try {
      if (Platform.OS === "web") {
        a.pause?.();
        try { a.src = ""; } catch {}
      } else {
        a.pause?.();
        a.remove?.();
      }
    } catch {}
    currentAudioRef.current = null;
    playingMsgIdRef.current = null;
  }, []);

  const playTTS = useCallback(
    async (text: string, msgId?: string) => {
      // De-dup: user double-taps the same message's play button.
      if (msgId && playingMsgIdRef.current === msgId) return;

      // Enforce "only one audio at a time" per TTS playbook.
      stopCurrentAudio();

      const myToken = ++playTokenRef.current;
      playingMsgIdRef.current = msgId ?? null;

      try {
        const token = await getToken();
        const res = await fetch(`${BACKEND_URL}/api/tts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          playingMsgIdRef.current = null;
          return;
        }
        // If another play started while we awaited, abandon this one.
        if (myToken !== playTokenRef.current) return;

        const data = await res.json();
        const audioUrl = `${BACKEND_URL}${data.url}`;

        if (Platform.OS === "web") {
          const a = new (globalThis as any).Audio(audioUrl);
          currentAudioRef.current = a;
          a.onended = () => {
            if (currentAudioRef.current === a) {
              currentAudioRef.current = null;
              playingMsgIdRef.current = null;
            }
          };
          a.onerror = () => {
            if (currentAudioRef.current === a) {
              currentAudioRef.current = null;
              playingMsgIdRef.current = null;
            }
          };
          try { await a.play(); } catch {}
        } else {
          const { createAudioPlayer, setAudioModeAsync } = await import(
            "expo-audio"
          );
          try {
            await setAudioModeAsync({
              playsInSilentMode: true,
              allowsRecording: false,
            } as any);
          } catch {}
          // Second check after awaits.
          if (myToken !== playTokenRef.current) return;
          const player = createAudioPlayer({ uri: audioUrl });
          currentAudioRef.current = player;
          player.play();
        }
      } catch {
        playingMsgIdRef.current = null;
      }
    },
    [stopCurrentAudio],
  );

  const sendMessageMut = useMutation({
    mutationFn: async (payload: {
      text: string;
      image_base64?: string;
      audio_base64?: string;
      audio_mime?: string;
      video_base64?: string;
      video_mime?: string;
      context?: string;
    }) => {
      return apiFetch<{ id: string; role: "assistant"; text: string }>(
        "/api/chat/message",
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: (reply) => {
      setMessages((m) => [
        ...m,
        { id: reply.id, role: "assistant", text: reply.text },
      ]);
      scrollToEnd();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      // No auto-play: the user taps "HEAR RIFF SAY IT" to play.
      // This avoids the double-play bug where tapping the button overlapped
      // with the automatic playback.
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  const buildAudioContext = useCallback(() => {
    const samples = pitchSamplesRef.current.slice(-30);
    if (samples.length === 0) return "";
    const timeline = samples
      .map((s) => `${s.t.toFixed(1)}s:${s.note}`)
      .join(" → ");
    return `Detected pitch timeline during the clip: ${timeline}.`;
  }, []);

  const captureAndCritique = useCallback(async () => {
    if (!cameraOn || !cameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setThinkingLabel("Riff is looking at your photo…");
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: false,
        skipProcessing: true,
      });
      if (!photo?.uri) {
        setThinkingLabel(null);
        return;
      }
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 720 } }],
        {
          compress: 0.65,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
      if (!resized.base64) {
        setThinkingLabel(null);
        return;
      }

      let context = "The student just snapped a photo during a live practice session.";
      if (pitch.note) context += ` Current pitch: ${pitch.note}.`;
      if (midi.events.length)
        context += ` Recent MIDI notes: ${midi.events
          .slice(0, 5)
          .map((e) => e.name)
          .join(", ")}.`;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: "📸 Here's a snapshot — what should I fix?",
      };
      setMessages((m) => [...m, userMsg]);
      scrollToEnd();
      setSending(true);
      await sendMessageMut.mutateAsync({
        text: "Please analyze my technique from this photo. Focus on 1-2 specific things to improve.",
        image_base64: resized.base64,
        context,
      });
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `s-${Date.now()}`,
          role: "assistant",
          text: "Couldn't capture that one — try again?",
        },
      ]);
    } finally {
      setThinkingLabel(null);
      setSending(false);
    }
  }, [cameraOn, pitch, midi, sendMessageMut]);

  const recordAndSend = useCallback(async () => {
    if (recording) return;
    setRecording(true);
    const SECS = 6;
    setRecCountdown(SECS);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    pitchT0Ref.current = Date.now();
    pitchSamplesRef.current = [];

    // Live countdown
    const tickInterval = setInterval(() => {
      setRecCountdown((n) => (n > 0 ? n - 1 : 0));
    }, 1000);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: `🎙️ Recording ${SECS}s for Riff — play now!`,
    };
    setMessages((m) => [...m, userMsg]);
    scrollToEnd();

    let clip =
      Platform.OS === "web"
        ? await recordWebClip(SECS)
        : await recordNativeClip(nativeRecorder, SECS);

    clearInterval(tickInterval);
    setRecCountdown(0);
    setRecording(false);

    if (!clip || !clip.base64) {
      setMessages((m) => [
        ...m,
        {
          id: `s-${Date.now()}`,
          role: "assistant",
          text:
            "Hmm — I couldn't capture any audio. Check that your browser/app has mic permission and try again.",
        },
      ]);
      return;
    }

    const timelineCtx = buildAudioContext();
    let context = `Student recorded ~${SECS}s of guitar audio (${clip.mime}, ${Math.round(
      clip.bytes / 1024,
    )} KB).`;
    if (timelineCtx) context += " " + timelineCtx;
    if (midi.events.length) {
      context +=
        " MIDI notes played: " +
        midi.events
          .slice(0, 10)
          .reverse()
          .map((e) => e.name)
          .join(" → ");
    }

    setThinkingLabel("Riff is listening to your clip…");
    setSending(true);
    try {
      await sendMessageMut.mutateAsync({
        text: "I just recorded a short clip of me playing. Please listen and tell me what to work on — timing, pitch, tone, feel.",
        audio_base64: clip.base64,
        audio_mime: clip.mime,
        context,
      });
    } finally {
      setThinkingLabel(null);
      setSending(false);
    }
  }, [recording, nativeRecorder, midi, buildAudioContext, sendMessageMut]);

  const pickAndUpload = useCallback(async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const picked = await pickMediaForUpload();
      if (!picked) return; // user canceled
      if ("reason" in (picked as any)) {
        const reason = (picked as any).reason;
        const txt =
          reason === "too_large"
            ? "That file is bigger than 20 MB — try trimming it or sending a shorter clip."
            : reason === "unsupported"
            ? "That file type isn't supported. Try an MP3, MP4, WAV, or MOV."
            : "Couldn't open that file — try picking it again?";
        setMessages((m) => [
          ...m,
          { id: `s-${Date.now()}`, role: "assistant", text: txt },
        ]);
        return;
      }
      const p = picked as Exclude<Awaited<ReturnType<typeof pickMediaForUpload>>, null | { kind: "error"; reason: any }>;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setMessages((m) => [
        ...m,
        {
          id: `u-${Date.now()}`,
          role: "user",
          text: `📎 Uploaded "${p.name}" (${Math.round(p.bytes / 1024)} KB) — please analyze.`,
        },
      ]);
      scrollToEnd();
      setThinkingLabel(
        p.kind === "video" ? "Riff is watching your clip…" : "Riff is listening to your clip…",
      );
      setSending(true);
      const payload: any = {
        text:
          p.kind === "video"
            ? "Please watch this clip of me playing and critique my technique, timing, and tone. Pick 1–2 priorities."
            : "Please listen to this recording and critique my playing — timing, pitch, tone, feel. Pick 1–2 priorities.",
        context: `Student uploaded a ${p.kind} file "${p.name}" (${p.mime}, ${Math.round(p.bytes / 1024)} KB).`,
      };
      if (p.kind === "audio") {
        payload.audio_base64 = p.base64;
        payload.audio_mime = p.mime;
      } else {
        payload.video_base64 = p.base64;
        payload.video_mime = p.mime;
      }
      await sendMessageMut.mutateAsync(payload);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `s-${Date.now()}`,
          role: "assistant",
          text: "Hmm — the upload didn't go through. Try again?",
        },
      ]);
    } finally {
      setSending(false);
      setThinkingLabel(null);
      setUploading(false);
    }
  }, [uploading, sendMessageMut]);

  const sendText = useCallback(async () => {
    const txt = input.trim();
    if (!txt || sending) return;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: txt,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    scrollToEnd();
    setSending(true);
    setThinkingLabel("Riff is thinking…");

    let context = "";
    if (listening) {
      if (pitch.note)
        context = `Live pitch: ${pitch.note} (${pitch.frequency?.toFixed(1)} Hz).`;
      if (midi.events.length) {
        context +=
          " Recent MIDI: " +
          midi.events
            .slice(0, 5)
            .map((e) => e.name)
            .join(", ") +
          ".";
      }
    }
    try {
      await sendMessageMut.mutateAsync({
        text: txt,
        context: context || undefined,
      });
    } finally {
      setSending(false);
      setThinkingLabel(null);
    }
  }, [input, sending, listening, pitch, midi, sendMessageMut]);

  const recBtnLabel = recording
    ? `RECORDING… ${recCountdown}s`
    : "RECORD 6s FOR RIFF";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="studio-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <RiffMark size={44} />
          <View style={styles.headerStack}>
            <Text style={styles.kicker}>LIVE WITH</Text>
            <Text style={styles.title}>Riff</Text>
          </View>
          <View style={styles.statusDot} />
        </View>

        <View style={styles.gear}>
          <Pressable
            testID="studio-toggle-camera"
            onPress={toggleCamera}
            style={[styles.gearBtn, cameraOn && styles.gearBtnActive]}
          >
            <Camera
              size={14}
              color={cameraOn ? colors.brand : colors.onSurfaceTertiary}
            />
            <Text style={[styles.gearTxt, cameraOn && styles.gearTxtActive]}>
              CAMERA
            </Text>
          </Pressable>
          <Pressable
            testID="studio-toggle-listen"
            onPress={toggleListening}
            style={[styles.gearBtn, listening && styles.gearBtnActive]}
          >
            <Mic
              size={14}
              color={listening ? colors.brand : colors.onSurfaceTertiary}
            />
            <Text style={[styles.gearTxt, listening && styles.gearTxtActive]}>
              LISTEN
            </Text>
          </Pressable>
          <Pressable
            testID="studio-toggle-rhythm"
            onPress={() => setRhythmOn((v) => !v)}
            style={[styles.gearBtn, rhythmOn && styles.gearBtnActive]}
          >
            <Music
              size={14}
              color={rhythmOn ? colors.brand : colors.onSurfaceTertiary}
            />
            <Text style={[styles.gearTxt, rhythmOn && styles.gearTxtActive]}>
              RHYTHM
            </Text>
          </Pressable>
          <Pressable
            testID="studio-upload-button"
            onPress={pickAndUpload}
            disabled={uploading || sending}
            style={[styles.gearBtn, uploading && styles.gearBtnActive, (uploading || sending) && { opacity: 0.6 }]}
          >
            <Upload
              size={14}
              color={uploading ? colors.brand : colors.onSurfaceTertiary}
            />
            <Text style={[styles.gearTxt, uploading && styles.gearTxtActive]}>
              {uploading ? "UPLOADING…" : "UPLOAD"}
            </Text>
          </Pressable>
        </View>

        {rhythmOn && <RhythmCoach />}

        {cameraOn && (
          <View style={styles.camPanel} testID="studio-camera-panel">
            <View style={styles.camPreview}>
              {permission?.granted ? (
                <CameraView
                  ref={cameraRef as any}
                  style={{ flex: 1 }}
                  facing="front"
                />
              ) : (
                <View style={styles.camPlaceholder}>
                  <Text style={styles.camPlaceholderTxt}>
                    Camera permission needed
                  </Text>
                </View>
              )}
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Text style={styles.liveTxt}>LIVE</Text>
              </View>
            </View>
            <Pressable
              testID="studio-snap-photo-button"
              onPress={captureAndCritique}
              disabled={sending}
              style={[styles.primaryBtn, sending && styles.primaryBtnDisabled]}
            >
              <ImageIcon size={16} color={colors.onBrandPrimary} />
              <Text style={styles.primaryTxt}>
                {sending ? "SENDING TO RIFF…" : "SNAP PHOTO & SEND TO RIFF"}
              </Text>
            </Pressable>
          </View>
        )}

        {listening && (
          <View style={styles.listenPanel}>
            <PitchMeter
              note={pitch.note}
              frequency={pitch.frequency}
              cents={pitch.cents}
              rms={pitch.rms}
              listening
            />
            <Pressable
              testID="studio-record-button"
              onPress={recordAndSend}
              disabled={recording || sending}
              style={[styles.recBtn, recording && styles.recBtnRecording]}
            >
              <CircleDot
                size={16}
                color={colors.onBrandPrimary}
                fill={colors.onBrandPrimary}
              />
              <Text style={styles.recTxt}>{recBtnLabel}</Text>
            </Pressable>
          </View>
        )}

        {midi.supported && (
          <View style={styles.midiPanel} testID="studio-midi-panel">
            <Text style={styles.midiLabel}>
              MIDI{" "}
              {midi.devices.length
                ? `· ${midi.devices.join(", ")}`
                : "· waiting for device"}
            </Text>
            {midi.events.length === 0 ? (
              <Text style={styles.midiEmpty}>
                Play any note on a connected MIDI device…
              </Text>
            ) : (
              <View style={styles.midiRow}>
                {midi.events.slice(0, 10).map((e) => (
                  <View key={e.id} style={styles.midiPill}>
                    <Text style={styles.midiPillTxt}>
                      {e.type === "on" ? "" : "·"}
                      {e.name}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <ScrollView
          ref={scrollRef as any}
          style={styles.chat}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={scrollToEnd}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <View key={m.id}>
              <ChatBubble msg={m} />
              {m.role === "assistant" && m.id !== "welcome" && (
                <Pressable
                  testID={`speak-${m.id}`}
                  onPress={() => playTTS(m.text, m.id)}
                  style={[
                    styles.listenHintBtn,
                    { paddingLeft: spacing.lg + spacing.md },
                  ]}
                >
                  <Volume2 size={13} color={colors.brand} />
                  <Text style={styles.listenTxt}>HEAR RIFF SAY IT</Text>
                </Pressable>
              )}
            </View>
          ))}
          {thinkingLabel && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.thinkingTxt}>{thinkingLabel.toUpperCase()}</Text>
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.inputBar,
            {
              paddingBottom:
                Math.max(insets.bottom, spacing.sm) + tabBarHeight + spacing.sm,
            },
          ]}
        >
          <TextInput
            testID="studio-text-input"
            style={styles.input}
            placeholder="Ask Riff anything…"
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={sendText}
            blurOnSubmit={false}
          />
          <Pressable
            testID="studio-send-button"
            disabled={sending || !input.trim()}
            onPress={sendText}
            style={[
              styles.send,
              (sending || !input.trim()) && { opacity: 0.5 },
            ]}
          >
            <Send size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
