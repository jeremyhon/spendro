"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export interface LocalUser {
  id: string;
  email: string;
}

interface AuthContextType {
  user: LocalUser | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ data?: { user: LocalUser }; error?: AuthError }>;
  signOut: () => Promise<void>;
}

type AuthError = { message: string; status?: number };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function createLocalUser(email = "local@spendro"): LocalUser {
  return {
    id: "local-user",
    email,
  };
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(createLocalUser());

  const signIn = useCallback(async (email: string, _password: string) => {
    const localUser = createLocalUser(email || "local@spendro");
    setUser(localUser);
    return { data: { user: localUser } };
  }, []);

  const signOut = useCallback(async () => {
    setUser(createLocalUser());
  }, []);

  const value = useMemo(
    () => ({ user, loading: false, signIn, signOut }),
    [user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
