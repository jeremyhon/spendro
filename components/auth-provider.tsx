"use client";

import type { RecordModel } from "pocketbase";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { pocketbase } from "@/lib/pocketbase/client";

interface AuthContextType {
  user: RecordModel | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ data?: { user: RecordModel }; error?: AuthError }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthError = { message: string; status?: number };

const COOKIE_OPTIONS = {
  httpOnly: false,
  secure: false,
  sameSite: "lax",
} as const;

function syncPocketbaseCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: PocketBase SDK cookie sync.
  document.cookie = pocketbase.authStore.exportToCookie(COOKIE_OPTIONS);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<RecordModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(pocketbase.authStore.record ?? null);
    setLoading(false);

    const removeListener = pocketbase.authStore.onChange((_token, model) => {
      setUser(model ?? null);
      setLoading(false);
      syncPocketbaseCookie();
    }, true);

    return () => removeListener();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const auth = await pocketbase
        .collection("users")
        .authWithPassword(email, password);
      syncPocketbaseCookie();
      return { data: { user: auth.record } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in";
      return { error: { message } };
    }
  };

  const signOut = async () => {
    try {
      pocketbase.authStore.clear();
      syncPocketbaseCookie();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
