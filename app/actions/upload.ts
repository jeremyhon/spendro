"use server";

import { revalidatePath } from "next/cache";
import { getPocketbaseServerAuth } from "@/lib/pocketbase/server";
import type { UploadResult } from "@/lib/types/expense";
import { processPdfExpenses } from "@/lib/utils/expense-processor";
import {
  checkDuplicateStatement,
  createStatementRecord,
  uploadToStorage,
  validateUploadedFile,
} from "@/lib/utils/file-handler";

/**
 * Main server action for uploading and processing bank statements
 */
export async function uploadStatement(
  formData: FormData
): Promise<UploadResult> {
  const { userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { success: false, message: "Not authenticated" };
  }

  // Validate uploaded file
  const validation = await validateUploadedFile(formData);
  if (!validation.isValid) {
    return {
      success: false,
      message: validation.error || "File validation failed",
    };
  }

  if (!validation.fileBuffer || !validation.checksum) {
    return { success: false, message: "Failed to process file" };
  }

  const file = formData.get("file") as File;
  const { fileBuffer } = validation;
  // Use environment variable to control duplicate detection
  const disableDuplicateDetection =
    process.env.DISABLE_DUPLICATE_DETECTION === "true";

  const checksum = disableDuplicateDetection
    ? Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    : validation.checksum;

  try {
    // Check for duplicate statements (controlled by environment variable)
    if (!disableDuplicateDetection) {
      const isDuplicate = await checkDuplicateStatement(userId, checksum);
      if (isDuplicate) {
        return {
          success: false,
          message: `Duplicate: '${file.name}' has already been uploaded.`,
        };
      }
    }

    // Upload file to Supabase Storage
    const { url: blobUrl } = await uploadToStorage(file, userId);

    // Create statement record
    const { id: statementId } = await createStatementRecord(
      userId,
      checksum,
      blobUrl,
      file.name
    );

    // Process PDF asynchronously
    processPdfExpenses(fileBuffer, statementId, userId).catch((error) => {
      console.error(
        `Async processing failed for statement ${statementId}:`,
        error
      );
    });

    revalidatePath("/");
    return {
      success: true,
      message: `'${file.name}' is being processed.`,
      statementId,
    };
  } catch (error) {
    console.error("Upload failed:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    return {
      success: false,
      message: `Upload failed for '${file.name}': ${errorMessage}`,
    };
  }
}
