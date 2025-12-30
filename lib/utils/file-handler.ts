import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createPocketbaseServerClient } from "@/lib/pocketbase/server";

/**
 * Validation result for uploaded files
 */
interface FileValidationResult {
  isValid: boolean;
  error?: string;
  fileBuffer?: Buffer;
  checksum?: string;
}

/**
 * Validate uploaded file
 */
export async function validateUploadedFile(
  formData: FormData
): Promise<FileValidationResult> {
  const file = formData.get("file") as File;

  if (!file || file.size === 0) {
    return {
      isValid: false,
      error: "No file provided.",
    };
  }

  if (!file.type || file.type !== "application/pdf") {
    return {
      isValid: false,
      error: "Only PDF files are supported.",
    };
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: "File size exceeds 10MB limit.",
    };
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const checksum = crypto
      .createHash("sha256")
      .update(fileBuffer)
      .digest("hex");

    return {
      isValid: true,
      fileBuffer,
      checksum,
    };
  } catch (_error) {
    return {
      isValid: false,
      error: "Failed to process file.",
    };
  }
}

/**
 * Upload file to Supabase Storage
 */
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const STORAGE_BUCKET = env.SUPABASE_STORAGE_BUCKET ?? "statements";
let bucketReady = false;
let bucketPromise: Promise<void> | null = null;

async function ensureBucketExists() {
  if (bucketReady) return;
  if (bucketPromise) {
    await bucketPromise;
    return;
  }

  bucketPromise = (async () => {
    const { data, error } = await supabase.storage.getBucket(STORAGE_BUCKET);
    const status = (error as { status?: number } | null)?.status;
    if (error && status !== 404) {
      throw error;
    }

    if (!data) {
      const { error: createError } = await supabase.storage.createBucket(
        STORAGE_BUCKET,
        {
          public: true,
        }
      );
      const createStatus = (createError as { status?: number } | null)?.status;
      if (createError && createStatus !== 409) {
        throw createError;
      }
    }

    bucketReady = true;
  })();

  await bucketPromise;
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function uploadToStorage(
  file: File,
  userId: string
): Promise<{ url: string }> {
  await ensureBucketExists();

  const suffix = crypto.randomUUID();
  const objectPath = `${userId}/${suffix}-${safeFilename(file.name)}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(objectPath);

  return { url: data.publicUrl };
}

/**
 * Create statement record in database
 */
export async function createStatementRecord(
  userId: string,
  checksum: string,
  blobUrl: string,
  fileName: string
): Promise<{ id: string }> {
  const pb = await createPocketbaseServerClient();

  const statement = await pb.collection("statements").create<{ id: string }>({
    user_id: userId,
    checksum: checksum,
    blob_url: blobUrl,
    file_name: fileName,
    status: "processing",
  });

  return { id: statement.id };
}

/**
 * Check for duplicate statements
 */
export async function checkDuplicateStatement(
  userId: string,
  checksum: string
): Promise<boolean> {
  const pb = await createPocketbaseServerClient();
  const safeChecksum = checksum.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await pb.collection("statements").getList(1, 1, {
    filter: `user_id = "${userId}" && checksum = "${safeChecksum}"`,
  });

  return result.totalItems > 0;
}
