import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { apiFetch, setToken, getToken } from "@/src/api/client";

WebBrowser.maybeCompleteAuthSession();

export type AuthUser = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
};

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

type Ctx = {
  state: AuthState;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("AuthContext missing");
  return v;
}

function extractSessionIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const processed = useRef<Set<string>>(new Set());
  const linkCaptured = useRef<string | null>(null);

  const loadMe = useCallback(async (): Promise<AuthState> => {
    const t = await getToken();
    if (!t) return { status: "unauthenticated" };
    try {
      const r = await apiFetch<{ user: AuthUser }>("/api/auth/me");
      return { status: "authenticated", user: r.user };
    } catch {
      return { status: "unauthenticated" };
    }
  }, []);

  const exchangeSession = useCallback(
    async (sessionId: string) => {
      if (processed.current.has(sessionId)) return;
      processed.current.add(sessionId);
      try {
        const r = await apiFetch<{ session_token: string; user: AuthUser }>(
          "/api/auth/session",
          { method: "POST", body: JSON.stringify({ session_id: sessionId }) },
        );
        await setToken(r.session_token);
        setState({ status: "authenticated", user: r.user });
        if (Platform.OS === "web") {
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete("session_id");
            const cleanHash = (window.location.hash || "").replace(
              /[#&]session_id=[^&]+/,
              "",
            );
            window.history.replaceState(
              window.history.state,
              "",
              url.pathname + url.search + cleanHash,
            );
          } catch {}
        }
      } catch (e) {
        setState({ status: "unauthenticated" });
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const sub = Linking.addEventListener("url", (ev) => {
      linkCaptured.current = ev.url;
      const sid = extractSessionIdFromUrl(ev.url);
      if (sid) void exchangeSession(sid);
    });

    (async () => {
      // Web: check location
      if (Platform.OS === "web") {
        const sid =
          extractSessionIdFromUrl(window.location.hash) ||
          extractSessionIdFromUrl(window.location.search);
        if (sid) {
          await exchangeSession(sid);
          return;
        }
      } else {
        const initial = await Linking.getInitialURL();
        const sid = extractSessionIdFromUrl(initial);
        if (sid) {
          await exchangeSession(sid);
          return;
        }
      }
      const next = await loadMe();
      if (!cancelled) setState(next);
    })();

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [exchangeSession, loadMe]);

  const signInWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? `${window.location.origin}/`
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    const direct = (result as any).url ?? null;
    const sid =
      extractSessionIdFromUrl(direct) ??
      extractSessionIdFromUrl(linkCaptured.current) ??
      extractSessionIdFromUrl(await Linking.getInitialURL());
    if (sid) await exchangeSession(sid);
  }, [exchangeSession]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    await setToken(null);
    setState({ status: "unauthenticated" });
  }, []);

  const refresh = useCallback(async () => {
    const next = await loadMe();
    setState(next);
  }, [loadMe]);

  return (
    <AuthContext.Provider value={{ state, signInWithGoogle, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
