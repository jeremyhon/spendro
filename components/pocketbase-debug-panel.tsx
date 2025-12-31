"use client";

import { useMemo, useState } from "react";
import { usePocketbaseAuth } from "@/hooks/use-pocketbase-auth";
import { usePocketbaseExpenses } from "@/hooks/use-pocketbase-expenses";
import { pocketbase } from "@/lib/pocketbase/client";

const MAX_ROWS = 200;

export function PocketbaseDebugPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const { user, isValid, loading, error, signIn, signOut } =
    usePocketbaseAuth();
  const {
    expenses,
    loading: expensesLoading,
    error: expensesError,
    subscriptionError,
    lastEventAt,
  } = usePocketbaseExpenses({ enabled: isValid });

  const userEmail = (user as { email?: string } | null)?.email ?? "unknown";

  const visibleExpenses = useMemo(() => {
    if (showAllExpenses) return expenses;
    return expenses.slice(0, MAX_ROWS);
  }, [expenses, showAllExpenses]);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) return;
    await signIn(email, password);
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            PocketBase Debug
          </h1>
          <p className="text-sm text-muted-foreground">
            Base URL: {pocketbase.baseUrl}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">
            Auth: {isValid ? `signed in as ${userEmail}` : "signed out"}
          </span>
          {lastEventAt && (
            <span className="rounded-full bg-muted px-3 py-1">
              Last SSE event: {lastEventAt}
            </span>
          )}
        </div>

        {!isValid ? (
          <form className="mt-6 grid gap-4 md:max-w-md" onSubmit={handleSignIn}>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="pb-email">
                Email
              </label>
              <input
                id="pb-email"
                type="email"
                className="rounded-md border px-3 py-2 text-sm"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="pb-password">
                Password
              </label>
              <input
                id="pb-password"
                type="password"
                className="rounded-md border px-3 py-2 text-sm"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className={
                "rounded-md bg-primary px-4 py-2 text-sm font-medium " +
                "text-primary-foreground"
              }
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
            {error && (
              <div
                className={
                  "rounded-lg border border-destructive/30 " +
                  "bg-destructive/10 px-4 py-3 text-sm text-destructive"
                }
              >
                {error}
              </div>
            )}
          </form>
        ) : (
          <div className="mt-6">
            <button
              type="button"
              onClick={signOut}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Sign out
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            PocketBase Expenses
          </h2>
          <p className="text-sm text-muted-foreground">
            QueryCollection + SSE invalidation POC
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">
            Status: {expensesLoading ? "loading" : expensesError || "ok"}
          </span>
          <span className="rounded-full bg-muted px-3 py-1">
            Total rows: {expenses.length}
          </span>
          {subscriptionError && (
            <span className="rounded-full bg-muted px-3 py-1 text-destructive">
              SSE: {subscriptionError}
            </span>
          )}
          {expenses.length > MAX_ROWS && (
            <button
              type="button"
              onClick={() => setShowAllExpenses((prev) => !prev)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
            >
              {showAllExpenses ? "Show first 200" : "Show all"}
            </button>
          )}
        </div>

        <div className="mt-6">
          <h3
            className={
              "text-sm font-semibold uppercase tracking-wide " +
              "text-muted-foreground"
            }
          >
            Rows (JSON)
          </h3>
          <pre
            className={
              "mt-2 max-h-[32rem] overflow-auto rounded-lg " +
              "bg-muted p-4 text-xs"
            }
          >
            {JSON.stringify(visibleExpenses, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
}
