// Pick an audio or video file and prepare it for upload.
// Reports stage progress (picking → reading → ready) via onStage.
// Files are sent as multipart form data (streamed from disk on native), never base64-encoded.

import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

export type UploadStage =
  | { stage: "picking" }
  | { stage: "reading"; name: string; bytes: number }
  | { stage: "encoding"; name: string; bytes: number; percent: number }
  | { stage: "ready"; name: string; bytes: number }
  | { stage: "canceled" };

export type Pickable =
  | { kind: "audio"; file: UploadFileRef; mime: string; name: string; bytes: number; localUrl?: string }
  | { kind: "video"; file: UploadFileRef; mime: string; name: string; bytes: number; localUrl?: string }
  | null;

/** Web: a Blob/File. Native: a file:// URI that React Native streams from disk. */
export type UploadFileRef = { blob: Blob } | { uri: string };

export const MAX_UPLOAD_MB = 500;
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

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

    let resolvedMime =
      mime ||
      (/\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(name) ? "video/mp4" : "audio/mp4");

    // Web: use the picked File/Blob directly (no copy). Native: keep the file:// URI;
    // React Native's FormData streams it from disk, so the file is never loaded into JS memory.
    let file: UploadFileRef;
    let actualBytes = declaredSize;
    if (Platform.OS === "web") {
      const blob: Blob = (asset as any).file ?? (await (await fetch(asset.uri)).blob());
      actualBytes = blob.size || declaredSize;
      if (actualBytes > MAX_BYTES) {
        return { kind: "error", reason: "too_large" };
      }
      if (!mime && blob.type) resolvedMime = blob.type.toLowerCase();
      file = { blob };
    } else {
      file = { uri: asset.uri };
    }

    onStage?.({ stage: "ready", name, bytes: actualBytes });

    // Make the picked file playable in-app:
    //  - web: create an object URL from the already-fetched blob;
    //  - native: expo-document-picker's cached file:// URI works directly in players.
    let localUrl: string | undefined;
    try {
      if (Platform.OS === "web") {
        localUrl = (globalThis as any).URL?.createObjectURL?.((file as { blob: Blob }).blob);
      } else {
        localUrl = asset.uri;
      }
    } catch {}

    return {
      kind: resolvedMime.startsWith("video/") ? "video" : "audio",
      file,
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

/** Build the multipart body for POST /api/chat/upload. */
export function buildUploadForm(
  p: { file: UploadFileRef; mime: string; name: string },
  fields: { text: string; context?: string },
): FormData {
  const form = new FormData();
  form.append("text", fields.text);
  if (fields.context) form.append("context", fields.context);
  if ("blob" in p.file) {
    form.append("file", p.file.blob, p.name);
  } else {
    // React Native's FormData accepts { uri, name, type } and streams the file.
    form.append("file", { uri: p.file.uri, name: p.name, type: p.mime } as any);
  }
  return form;
}

/** POST a body with XHR so upload progress is observable. */
function xhrPost<T = any>(
  url: string,
  body: any,
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
      xhr.send(body);
    } catch (e) {
      reject(e);
    }
  });
}

/** POST a JSON payload with upload progress. */
export function postJsonWithProgress<T = any>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
) {
  return xhrPost<T>(url, typeof body === "string" ? body : JSON.stringify(body), headers, onProgress);
}

/** POST multipart form data with upload progress. Don't set Content-Type — the runtime adds the boundary. */
export function postFormWithProgress<T = any>(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
) {
  return xhrPost<T>(url, form, headers, onProgress);
}
