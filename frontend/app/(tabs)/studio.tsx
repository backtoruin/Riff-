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
import { Camera, Mic, Send, Volume2, Keyboard as KeyboardIcon } from "lucide-react-native";

import { apiFetch, BACKEND_URL, getToken } from "@/src/api/client";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";
import { RiffMark } from "@/src/components/RiffMark";
import { ChatBubble, ChatMessage } from "@/src/components/ChatBubble";
import { PitchMeter } from "@/src/components/PitchMeter";
import { startPitchDetection, PitchState } from "@/src/lib/pitch";
import { startMidi, MidiState } from "@/src/lib/midi";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

type Progress = { streak_days: number; level: number };

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
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  gear: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  gearBtn: {
    flex: 1,
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

  cameraWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    height: 180,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  cameraPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  cameraPlaceholderTxt: { color: colors.muted, fontSize: 12 },
  cameraOverlay: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recDot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#121212CC",
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  recDotBubble: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  recTxt: { color: colors.onSurface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  critique: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  critiqueTxt: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },

  pitchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },

  midiPanel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  midiLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "600", marginBottom: spacing.xs },
  midiRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  midiPill: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
  },
  midiPillTxt: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  midiEmpty: { color: colors.muted, fontSize: 12, fontStyle: "italic" },

  chat: { flex: 1 },
  chatContent: { paddingVertical: spacing.md, gap: 0 },

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
  listenBtn: {
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
    "Hey — I'm Riff. Pop on the camera and I'll check your posture, or just play something and I'll tell you what to fix. What are we working on today?",
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
  const [cameraOn, setCameraOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [midi, setMidi] = useState<MidiState>({ supported: false, devices: [], events: [] });
  const [pitch, setPitch] = useState<PitchState>({ frequency: null, note: null, cents: 0, rms: 0 });

  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const scrollRef = useRef<ScrollView | null>(null);
  const pitchStopRef = useRef<null | (() => void)>(null);
  const midiStopRef = useRef<null | (() => void)>(null);
  const audioPlayerRef = useRef<any>(null);
  const sessionLogged = useRef(false);

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
  const toggleListening = useCallback(async () => {
    if (listening) {
      pitchStopRef.current?.();
      midiStopRef.current?.();
      pitchStopRef.current = null;
      midiStopRef.current = null;
      setListening(false);
      setPitch({ frequency: null, note: null, cents: 0, rms: 0 });
      return;
    }
    setListening(true);
    pitchStopRef.current = await startPitchDetection(setPitch);
    midiStopRef.current = await startMidi(setMidi);
  }, [listening]);

  useEffect(() => {
    return () => {
      pitchStopRef.current?.();
      midiStopRef.current?.();
      if (audioPlayerRef.current) {
        try {
          audioPlayerRef.current.pause?.();
          audioPlayerRef.current.remove?.();
        } catch {}
      }
    };
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
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const playTTS = useCallback(async (text: string) => {
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
      if (!res.ok) return;
      const data = await res.json();
      const audioUrl = `${BACKEND_URL}${data.url}`;
      if (Platform.OS === "web") {
        const a = new (globalThis as any).Audio(audioUrl);
        a.play().catch(() => {});
      } else {
        const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
        try {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false } as any);
        } catch {}
        if (audioPlayerRef.current) {
          try { audioPlayerRef.current.pause?.(); audioPlayerRef.current.remove?.(); } catch {}
        }
        const player = createAudioPlayer({ uri: audioUrl });
        audioPlayerRef.current = player;
        player.play();
      }
    } catch {}
  }, []);

  const sendMessageMut = useMutation({
    mutationFn: async (payload: { text: string; image_base64?: string; context?: string }) => {
      return apiFetch<{ id: string; role: "assistant"; text: string }>(
        "/api/chat/message",
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: (reply) => {
      setMessages((m) => [...m, { id: reply.id, role: "assistant", text: reply.text }]);
      scrollToEnd();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void playTTS(reply.text);
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  const captureAndCritique = useCallback(async () => {
    if (!cameraRef.current || !cameraOn) {
      await toggleCamera();
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: false,
        skipProcessing: true,
      });
      if (!photo?.uri) return;
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 720 } }],
        { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!resized.base64) return;

      // Compose context from live state
      let context = "The student is in a live practice session.";
      if (pitch.note) context += ` Current detected pitch: ${pitch.note} (${pitch.frequency?.toFixed(1)} Hz).`;
      if (midi.events.length) {
        const recent = midi.events.slice(0, 5).map((e) => e.name).join(", ");
        context += ` Recent MIDI notes: ${recent}.`;
      }

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: "📸 Please analyze my technique.",
      };
      setMessages((m) => [...m, userMsg]);
      scrollToEnd();
      setSending(true);
      await sendMessageMut.mutateAsync({
        text: "Please analyze my technique from this photo. Focus on 1-2 specific things.",
        image_base64: resized.base64,
        context,
      });
    } catch {
    } finally {
      setSending(false);
    }
  }, [cameraOn, toggleCamera, pitch, midi, sendMessageMut]);

  const sendText = useCallback(async () => {
    const txt = input.trim();
    if (!txt || sending) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text: txt };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    scrollToEnd();
    setSending(true);

    let context = "";
    if (listening) {
      if (pitch.note) context = `Live pitch: ${pitch.note} (${pitch.frequency?.toFixed(1)} Hz).`;
      if (midi.events.length) {
        const recent = midi.events.slice(0, 5).map((e) => e.name).join(", ");
        context += ` Recent MIDI: ${recent}.`;
      }
    }
    try {
      await sendMessageMut.mutateAsync({ text: txt, context: context || undefined });
    } finally {
      setSending(false);
    }
  }, [input, sending, listening, pitch, midi, sendMessageMut]);

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
            <Camera size={14} color={cameraOn ? colors.brand : colors.onSurfaceTertiary} />
            <Text style={[styles.gearTxt, cameraOn && styles.gearTxtActive]}>CAMERA</Text>
          </Pressable>
          <Pressable
            testID="studio-toggle-listen"
            onPress={toggleListening}
            style={[styles.gearBtn, listening && styles.gearBtnActive]}
          >
            <Mic size={14} color={listening ? colors.brand : colors.onSurfaceTertiary} />
            <Text style={[styles.gearTxt, listening && styles.gearTxtActive]}>LISTEN</Text>
          </Pressable>
        </View>

        {cameraOn && (
          <View style={styles.cameraWrap} testID="studio-camera-preview">
            {permission?.granted ? (
              <CameraView ref={cameraRef as any} style={{ flex: 1 }} facing="front" />
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.cameraPlaceholderTxt}>
                  Camera permission needed
                </Text>
              </View>
            )}
            <View style={styles.cameraOverlay}>
              <View style={styles.recDot}>
                <View style={styles.recDotBubble} />
                <Text style={styles.recTxt}>LIVE</Text>
              </View>
              <Pressable
                testID="studio-critique-button"
                onPress={captureAndCritique}
                style={styles.critique}
              >
                <Text style={styles.critiqueTxt}>ANALYZE MY TECHNIQUE</Text>
              </Pressable>
            </View>
          </View>
        )}

        {listening && (
          <View style={styles.pitchWrap}>
            <PitchMeter
              note={pitch.note}
              frequency={pitch.frequency}
              cents={pitch.cents}
              rms={pitch.rms}
              listening
            />
          </View>
        )}

        {midi.supported && (
          <View style={styles.midiPanel} testID="studio-midi-panel">
            <Text style={styles.midiLabel}>
              MIDI {midi.devices.length ? `· ${midi.devices.join(", ")}` : "· waiting for device"}
            </Text>
            {midi.events.length === 0 ? (
              <Text style={styles.midiEmpty}>Play any note on a connected MIDI device…</Text>
            ) : (
              <View style={styles.midiRow}>
                {midi.events.slice(0, 10).map((e) => (
                  <View key={e.id} style={styles.midiPill}>
                    <Text style={styles.midiPillTxt}>
                      {e.type === "on" ? "" : "·"}{e.name}
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
                  onPress={() => playTTS(m.text)}
                  style={[styles.listenBtn, { paddingLeft: spacing.lg + spacing.md }]}
                >
                  <Volume2 size={13} color={colors.brand} />
                  <Text style={styles.listenTxt}>HEAR RIFF SAY IT</Text>
                </Pressable>
              )}
            </View>
          ))}
          {sendMessageMut.isPending && (
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) + tabBarHeight + spacing.sm }]}>
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
            style={[styles.send, (sending || !input.trim()) && { opacity: 0.5 }]}
          >
            <Send size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
