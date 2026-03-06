"use client";

import type React from "react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
