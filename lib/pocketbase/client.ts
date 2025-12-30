import PocketBase from "pocketbase";
import { env } from "@/lib/env";

const pocketbaseUrl = env.NEXT_PUBLIC_POCKETBASE_URL ?? "http://localhost:8090";

export const pocketbase = new PocketBase(pocketbaseUrl);
