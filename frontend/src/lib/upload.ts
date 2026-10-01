// Pick an audio or video file via expo-document-picker, read it as base64.
// Returns a shape compatible with the chat endpoint's audio_* / video_* fields,
// plus a `kind` flag so the caller can decide which field to send under.

import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

export type Pickable =
  | { kind: "audio"; base64: string; mime: string; name: string; bytes: number }
  | { kind: "video"; base64: string; mime: string; name: string; bytes: number }
  | null;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — Gemini inline limit guardrail

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

export async function pickMediaForUpload(): Promise<
  | Pickable
  | { kind: "error"; reason: "too_large" | "unsupported" | "denied" | "unknown" }
> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["audio/*", "video/*"],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return null;
    const asset = res.assets?.[0];
    if (!asset?.uri) return { kind: "error", reason: "unknown" };
    const size = asset.size ?? 0;
    if (size > MAX_BYTES) return { kind: "error", reason: "too_large" };

    const mime = (asset.mimeType || "").toLowerCase();
    const isAudio = mime.startsWith("audio/");
    const isVideo = mime.startsWith("video/");
    if (!isAudio && !isVideo) {
      // Fallback: guess by extension
      const lower = (asset.name || "").toLowerCase();
      const audioExt = /\.(mp3|wav|m4a|aac|ogg|flac|webm|aif|aiff)$/.test(lower);
      const videoExt = /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/.test(lower);
      if (!audioExt && !videoExt) return { kind: "error", reason: "unsupported" };
    }

    let fetchUri = asset.uri;
    // On web, DocumentPicker gives us a blob: URL that fetch can read fine.
    const resp = await fetch(fetchUri);
    const blob = await resp.blob();
    const base64 = await blobToBase64(blob);

    const resolvedMime =
      mime ||
      blob.type ||
      (/\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(asset.name || "")
        ? "video/mp4"
        : "audio/mp4");

    return {
      kind: resolvedMime.startsWith("video/") ? "video" : "audio",
      base64,
      mime: resolvedMime.split(";")[0],
      name: asset.name || "upload",
      bytes: blob.size || size,
    };
  } catch (e) {
    console.warn("pick upload failed", e);
    return { kind: "error", reason: "unknown" };
  }
}
