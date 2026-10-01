import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";

export const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  "";

export const AUTH_TOKEN_KEY = "riff_session_token";

let tokenCache: string | null = null;

export async function getToken(): Promise<string | null> {
  if (tokenCache) return tokenCache;
  const v = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
  tokenCache = v || null;
  return tokenCache;
}

export async function setToken(token: string | null): Promise<void> {
  tokenCache = token;
  if (token) await storage.secureSet(AUTH_TOKEN_KEY, token);
  else await storage.secureRemove(AUTH_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, payload: any) {
    super(`${status}: ${JSON.stringify(payload)}`);
    this.status = status;
    this.payload = payload;
  }
}

export async function apiFetch<T = any>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401) {
      await setToken(null);
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}
