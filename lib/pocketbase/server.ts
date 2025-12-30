import { cookies } from "next/headers";
import PocketBase from "pocketbase";
import { env } from "@/lib/env";

const POCKETBASE_URL =
  env.NEXT_PUBLIC_POCKETBASE_URL ?? "http://localhost:8090";

async function buildCookieHeader() {
  const cookieStore = await cookies();
  const entries = cookieStore.getAll();
  if (entries.length === 0) return "";
  return entries
    .map((cookie: { name: string; value: string }) => {
      return `${cookie.name}=${cookie.value}`;
    })
    .join("; ");
}

export async function createPocketbaseServerClient() {
  const pb = new PocketBase(POCKETBASE_URL);
  pb.authStore.loadFromCookie(await buildCookieHeader());
  return pb;
}

export async function getPocketbaseServerAuth() {
  const pb = await createPocketbaseServerClient();
  const record = pb.authStore.record;
  return {
    pb,
    user: record,
    userId: record?.id ?? null,
    isValid: pb.authStore.isValid,
  };
}
