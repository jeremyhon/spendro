"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { electricClient } from "@/lib/electric/client";
import { SHAPE_REGISTRY } from "@/lib/electric/shapes";

const MAX_ROWS = 200;

type DebugSectionState = {
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
};

const initialSectionState: DebugSectionState = {
  rows: [],
  loading: true,
  error: null,
};

export function ElectricDebugPanel() {
  const { user, loading: authLoading } = useAuth();
  const [expensesState, setExpensesState] =
    useState<DebugSectionState>(initialSectionState);
  const [statementsState, setStatementsState] =
    useState<DebugSectionState>(initialSectionState);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showAllStatements, setShowAllStatements] = useState(false);

  const expensesParams = useMemo(() => SHAPE_REGISTRY.expenseTable(), []);
  const statementsParams = useMemo(() => SHAPE_REGISTRY.statementStatus(), []);

  useEffect(() => {
    if (authLoading) return;

    if (!user?.id) {
      setExpensesState({
        rows: [],
        loading: false,
        error: "User not authenticated.",
      });
      setStatementsState({
        rows: [],
        loading: false,
        error: "User not authenticated.",
      });
      return;
    }

    setExpensesState((prev) => ({ ...prev, loading: true, error: null }));
    setStatementsState((prev) => ({ ...prev, loading: true, error: null }));

    const expensesShape = electricClient.createShape(expensesParams);
    const statementsShape = electricClient.createShape(statementsParams);

    const unsubscribeExpenses = expensesShape.subscribe(({ rows }) => {
      setExpensesState({ rows, loading: false, error: null });
    });

    const unsubscribeStatements = statementsShape.subscribe(({ rows }) => {
      setStatementsState({ rows, loading: false, error: null });
    });

    return () => {
      unsubscribeExpenses?.();
      unsubscribeStatements?.();
    };
  }, [authLoading, user?.id, expensesParams, statementsParams]);

  const expenseRows = useMemo(() => {
    if (showAllExpenses) return expensesState.rows;
    return expensesState.rows.slice(0, MAX_ROWS);
  }, [expensesState.rows, showAllExpenses]);

  const statementRows = useMemo(() => {
    if (showAllStatements) return statementsState.rows;
    return statementsState.rows.slice(0, MAX_ROWS);
  }, [statementsState.rows, showAllStatements]);

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Electric Debug: Expenses
          </h1>
          <p className="text-sm text-muted-foreground">
            Raw shape stream data (showing{" "}
            {showAllExpenses
              ? expensesState.rows.length
              : Math.min(expensesState.rows.length, MAX_ROWS)}{" "}
            rows).
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">
            Status:{" "}
            {expensesState.loading ? "loading" : expensesState.error || "ok"}
          </span>
          <span className="rounded-full bg-muted px-3 py-1">
            Total rows: {expensesState.rows.length}
          </span>
          {expensesState.rows.length > MAX_ROWS && (
            <button
              type="button"
              onClick={() => setShowAllExpenses((prev) => !prev)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
            >
              {showAllExpenses ? "Show first 200" : "Show all"}
            </button>
          )}
        </div>

        {expensesState.error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {expensesState.error}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Shape Params
            </h2>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(expensesParams, null, 2)}
            </pre>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rows (JSON)
            </h2>
            <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(expenseRows, null, 2)}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Electric Debug: Statements
          </h1>
          <p className="text-sm text-muted-foreground">
            Raw statement status shape data (showing{" "}
            {showAllStatements
              ? statementsState.rows.length
              : Math.min(statementsState.rows.length, MAX_ROWS)}{" "}
            rows).
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">
            Status:{" "}
            {statementsState.loading
              ? "loading"
              : statementsState.error || "ok"}
          </span>
          <span className="rounded-full bg-muted px-3 py-1">
            Total rows: {statementsState.rows.length}
          </span>
          {statementsState.rows.length > MAX_ROWS && (
            <button
              type="button"
              onClick={() => setShowAllStatements((prev) => !prev)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
            >
              {showAllStatements ? "Show first 200" : "Show all"}
            </button>
          )}
        </div>

        {statementsState.error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {statementsState.error}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Shape Params
            </h2>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(statementsParams, null, 2)}
            </pre>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rows (JSON)
            </h2>
            <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(statementRows, null, 2)}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
