"use server";

import { getPocketbaseServerAuth } from "@/lib/pocketbase/server";

type IngestionSettingsRecord = {
  id: string;
  prompt?: string | null;
};

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function getIngestionPrompt(): Promise<{
  prompt: string;
  error?: string;
}> {
  const { pb, userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { prompt: "", error: "Unauthorized" };
  }

  try {
    const record = await pb
      .collection("ingestion_settings")
      .getFirstListItem<IngestionSettingsRecord>(
        `user_id = "${escapeFilter(userId)}"`,
        {
          fields: "id,prompt",
        }
      );
    return { prompt: record.prompt ?? "" };
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
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
  const { pb, userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  const normalizedPrompt = prompt.trim();
  const safeUserId = escapeFilter(userId);

  try {
    const existing = await pb
      .collection("ingestion_settings")
      .getFirstListItem<IngestionSettingsRecord>(`user_id = "${safeUserId}"`, {
        fields: "id",
      });

    await pb.collection("ingestion_settings").update(existing.id, {
      prompt: normalizedPrompt,
    });

    return { success: true };
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
      try {
        await pb.collection("ingestion_settings").create({
          user_id: userId,
          prompt: normalizedPrompt,
        });
        return { success: true };
      } catch (createError) {
        const message =
          createError instanceof Error
            ? createError.message
            : "Failed to save prompt";
        return { error: message };
      }
    }

    const message =
      error instanceof Error ? error.message : "Failed to save prompt";
    return { error: message };
  }
}
