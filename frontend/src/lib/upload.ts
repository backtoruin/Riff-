// Pick an audio or video file and prepare it for upload.
// Reports stage progress (picking → reading → encoding → ready) via onStage.

import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

export type UploadStage =
  | { stage: "picking" }
  | { stage: "reading"; name: string; bytes: number }
  | { stage: "encoding"; name: string; bytes: number; percent: number }
  | { stage: "ready"; name: string; bytes: number }
  | { stage: "canceled" };

export type Pickable =
  | { kind: "audio"; base64: string; mime: string; name: string; bytes: number; localUrl?: string }
  | { kind: "video"; base64: string; mime: string; name: string; bytes: number; localUrl?: string }
  | null;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — Gemini inline limit guardrail

async function blobToBase64WithProgress(
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(100, (e.loaded / e.total) * 100));
      }
    };
    reader.onload = () => {
      const dataUrl = (reader.result as string) || "";
      onProgress(100);
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.readAsDataURL(blob);
  });
}

export async function pickMediaForUpload(
  onStage?: (s: UploadStage) => void,
): Promise<
  | Pickable
  | { kind: "error"; reason: "too_large" | "unsupported" | "denied" | "unknown"; details?: string }
> {
  try {
    onStage?.({ stage: "picking" });
    const res = await DocumentPicker.getDocumentAsync({
      type: ["audio/*", "video/*"],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) {
      onStage?.({ stage: "canceled" });
      return null;
    }
    const asset = res.assets?.[0];
    if (!asset?.uri) {
      return { kind: "error", reason: "unknown", details: "no_asset_uri" };
    }
    const name = asset.name || "upload";
    const declaredSize = asset.size ?? 0;

    if (declaredSize && declaredSize > MAX_BYTES) {
      return { kind: "error", reason: "too_large" };
    }

    const mime = (asset.mimeType || "").toLowerCase();
    const isAudio = mime.startsWith("audio/");
    const isVideo = mime.startsWith("video/");
    if (!isAudio && !isVideo) {
      const lower = name.toLowerCase();
      const audioExt = /\.(mp3|wav|m4a|aac|ogg|flac|webm|aif|aiff)$/.test(lower);
      const videoExt = /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/.test(lower);
      if (!audioExt && !videoExt) {
        return { kind: "error", reason: "unsupported", details: mime || "unknown_mime" };
      }
    }

    onStage?.({ stage: "reading", name, bytes: declaredSize });

    // On web, DocumentPicker returns a blob: URL that fetch resolves instantly.
    // On native, fetch(file:///…) reads the file from disk.
    const resp = await fetch(asset.uri);
    const blob = await resp.blob();
    const actualBytes = blob.size || declaredSize;

    if (actualBytes > MAX_BYTES) {
      return { kind: "error", reason: "too_large" };
    }

    onStage?.({ stage: "encoding", name, bytes: actualBytes, percent: 0 });
    const base64 = await blobToBase64WithProgress(blob, (p) => {
      onStage?.({ stage: "encoding", name, bytes: actualBytes, percent: p });
    });

    const resolvedMime =
      mime ||
      blob.type ||
      (/\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(name)
        ? "video/mp4"
        : "audio/mp4");

    onStage?.({ stage: "ready", name, bytes: actualBytes });

    // Make the picked file playable in-app:
    //  - web: create an object URL from the already-fetched blob;
    //  - native: expo-document-picker's cached file:// URI works directly in players.
    let localUrl: string | undefined;
    try {
      if (Platform.OS === "web") {
        localUrl = (globalThis as any).URL?.createObjectURL?.(blob);
      } else {
        localUrl = asset.uri;
      }
    } catch {}

    return {
      kind: resolvedMime.startsWith("video/") ? "video" : "audio",
      base64,
      mime: resolvedMime.split(";")[0],
      name,
      bytes: actualBytes,
      localUrl,
    };
  } catch (e: any) {
    console.warn("pick upload failed", e);
    return { kind: "error", reason: "unknown", details: e?.message || String(e) };
  }
}

/** POST a JSON payload with XHR so upload progress is observable. */
export function postJsonWithProgress<T = any>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ status: number; json: T | null }> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new (globalThis as any).XMLHttpRequest();
      xhr.open("POST", url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      if (xhr.upload) {
        xhr.upload.onprogress = (e: any) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }
      xhr.onload = () => {
        let parsed: T | null = null;
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: xhr.status, json: parsed });
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.ontimeout = () => reject(new Error("timeout"));
      xhr.send(typeof body === "string" ? body : JSON.stringify(body));
    } catch (e) {
      reject(e);
    }
  });
}
