"use server";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveLocalPaths } from "@/lib/local/paths";

async function getLocalIngestionPromptPath(): Promise<string> {
  const { homeDir } = resolveLocalPaths();
  await mkdir(homeDir, { recursive: true });
  return join(homeDir, "ingestion-prompt.txt");
}

export async function getIngestionPrompt(): Promise<{
  prompt: string;
  error?: string;
}> {
  try {
    const path = await getLocalIngestionPromptPath();
    const prompt = await readFile(path, "utf8");
    return { prompt: prompt.trim() };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return { prompt: "" };
    }

    const message =
      error instanceof Error ? error.message : "Failed to load prompt";
    return { prompt: "", error: message };
  }
}

export async function saveIngestionPrompt(
  prompt: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const path = await getLocalIngestionPromptPath();
    await writeFile(path, prompt.trim(), "utf8");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save prompt";
    return { error: message };
  }
}
