import { NextResponse } from "next/server";
import PocketBase, { type RecordModel } from "pocketbase";
import { env } from "@/lib/env";

const POCKETBASE_URL =
  env.NEXT_PUBLIC_POCKETBASE_URL ?? "http://localhost:8090";

type AuthCookiePayload = {
  token?: string | null;
  record?: RecordModel | null;
};

function isRecordModel(value: unknown): value is RecordModel {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.collectionId === "string" &&
    typeof candidate.collectionName === "string"
  );
}

function isSecureRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  return new URL(request.url).protocol === "https:";
}

export async function POST(request: Request) {
  let payload: AuthCookiePayload = {};

  try {
    payload = (await request.json()) as AuthCookiePayload;
  } catch {
    payload = {};
  }

  const pb = new PocketBase(POCKETBASE_URL);

  if (payload.token && isRecordModel(payload.record)) {
    pb.authStore.save(payload.token, payload.record);
  } else {
    pb.authStore.clear();
  }

  const cookie = pb.authStore.exportToCookie({
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
  });

  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", cookie);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
