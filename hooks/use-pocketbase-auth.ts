"use client";

import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";
import { pocketbase } from "@/lib/pocketbase/client";
import {
  POCKETBASE_EXPENSES_QUERY_KEY,
  pocketbaseQueryClient,
} from "@/lib/pocketbase/expenses";

interface PocketbaseAuthState {
  user: RecordModel | null;
  isValid: boolean;
  loading: boolean;
  error: string | null;
}

const AUTH_COLLECTION = "users";

export function usePocketbaseAuth() {
  const [state, setState] = useState<PocketbaseAuthState>({
    user: pocketbase.authStore.model ?? null,
    isValid: pocketbase.authStore.isValid,
    loading: false,
    error: null,
  });

  useEffect(() => {
    return pocketbase.authStore.onChange((_token, model) => {
      setState((prev) => ({
        ...prev,
        user: model ?? null,
        isValid: pocketbase.authStore.isValid,
      }));
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      await pocketbase
        .collection(AUTH_COLLECTION)
        .authWithPassword(email, password);
      pocketbaseQueryClient.invalidateQueries({
        queryKey: POCKETBASE_EXPENSES_QUERY_KEY,
      });
      setState((prev) => ({ ...prev, loading: false }));
      return { ok: true } as const;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in";
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return { ok: false, error: message } as const;
    }
  }, []);

  const signOut = useCallback(() => {
    pocketbase.authStore.clear();
    pocketbaseQueryClient.invalidateQueries({
      queryKey: POCKETBASE_EXPENSES_QUERY_KEY,
    });
    setState((prev) => ({
      ...prev,
      user: null,
      isValid: false,
    }));
  }, []);

  return {
    ...state,
    signIn,
    signOut,
  };
}
