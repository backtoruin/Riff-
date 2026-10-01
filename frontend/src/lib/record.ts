// Cross-platform short audio recorder.
// Web: MediaRecorder → audio/webm or audio/mp4.
// Native: expo-audio useAudioRecorder → .m4a.
//
// Returns { base64, mime, bytes } or null on failure/denial.

import { Platform } from "react-native";

export type Recording = { base64: string; mime: string; bytes: number } | null;

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = (reader.result as string) || "";
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.readAsDataURL(blob);
  });
}

/** Pick the best mime the browser supports (prefer formats Gemini likes). */
function pickWebMime(): string {
  const MR: any = (globalThis as any).MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) if (MR.isTypeSupported(c)) return c;
  return "";
}

export async function recordWebClip(seconds: number): Promise<Recording> {
  try {
    const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
    const mime = pickWebMime();
    const options = mime ? { mimeType: mime } : undefined;
    const MR: any = (globalThis as any).MediaRecorder;
    if (!MR) {
      stream.getTracks().forEach((t: any) => t.stop());
      return null;
    }
    const rec = new MR(stream, options);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e: any) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.start();
      setTimeout(() => {
        try {
          rec.stop();
        } catch {}
      }, seconds * 1000);
    });
    stream.getTracks().forEach((t: any) => t.stop());
    const outType = mime.split(";")[0] || "audio/webm";
    const blob = new Blob(chunks, { type: outType });
    const base64 = await blobToBase64(blob);
    return { base64, mime: outType, bytes: blob.size };
  } catch (e) {
    console.warn("web record failed", e);
    return null;
  }
}

/** Native recording via expo-audio. The recorder instance must be a hook result. */
export async function recordNativeClip(
  recorder: any,
  seconds: number,
): Promise<Recording> {
  try {
    const { AudioModule, setAudioModeAsync } = await import("expo-audio");
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return null;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true } as any);
    } catch {}
    await recorder.prepareToRecordAsync();
    recorder.record();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    await recorder.stop();
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true } as any);
    } catch {}
    const uri: string | null = recorder.uri;
    if (!uri) return null;
    const resp = await fetch(uri);
    const blob = await resp.blob();
    const base64 = await blobToBase64(blob);
    const mime = blob.type || (Platform.OS === "ios" ? "audio/m4a" : "audio/mp4");
    return { base64, mime, bytes: blob.size };
  } catch (e) {
    console.warn("native record failed", e);
    return null;
  }
}
