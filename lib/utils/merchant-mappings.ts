import { createPocketbaseServerClient } from "@/lib/pocketbase/server";
import type {
  MerchantMapping,
  MerchantMappingInsert,
} from "@/lib/types/expense";

/**
 * Get merchant mapping for a user (case-insensitive)
 */
export async function getMerchantMapping(
  userId: string,
  merchantName: string
): Promise<MerchantMapping | null> {
  const pb = await createPocketbaseServerClient();
  const normalized = merchantName.toUpperCase();
  const list = await pb
    .collection("merchant_mappings")
    .getList<MerchantMapping>(1, 1, {
      filter: `user_id = "${userId}" && merchant_name = "${normalized}"`,
    });

  return list.items?.[0] ?? null;
}

/**
 * Create a new merchant mapping
 * Returns false if mapping already exists (ignore duplicate)
 */
export async function createMerchantMapping(
  userId: string,
  merchantName: string,
  category: string
): Promise<boolean> {
  const mappingData: MerchantMappingInsert = {
    user_id: userId,
    merchant_name: merchantName.toUpperCase(),
    category,
  };

  const pb = await createPocketbaseServerClient();
  try {
    await pb.collection("merchant_mappings").create(mappingData);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create mapping";
    if (message.toLowerCase().includes("unique")) {
      return false;
    }
    console.error("Error creating merchant mapping:", message);
    return false;
  }

  return true;
}

/**
 * Update all expenses for a merchant to a new category
 */
export async function updateAllExpensesByMerchant(
  userId: string,
  merchantName: string,
  newCategory: string
): Promise<{ success: boolean; updatedCount: number }> {
  const { getOrCreateCategoryByName } = await import(
    "@/app/actions/categories"
  );

  // Get category ID for the new category
  const categoryId = await getOrCreateCategoryByName(newCategory, userId);

  const pb = await createPocketbaseServerClient();
  const expenses = await pb.collection("expenses").getFullList({
    filter: `user_id = "${userId}"`,
  });

  const matches = expenses.filter((expense) =>
    String(expense.merchant ?? "")
      .toLowerCase()
      .includes(merchantName.toLowerCase())
  );

  for (const expense of matches) {
    await pb.collection("expenses").update(expense.id, {
      category: newCategory,
      category_id: categoryId,
      category_text: newCategory,
    });
  }

  return { success: true, updatedCount: matches.length };
}

/**
 * Get all merchant mappings for a user
 */
export async function listUserMerchantMappings(
  userId: string
): Promise<MerchantMapping[]> {
  const pb = await createPocketbaseServerClient();

  const data = await pb
    .collection("merchant_mappings")
    .getFullList<MerchantMapping>({
      filter: `user_id = "${userId}"`,
      sort: "merchant_name",
    });

  return data || [];
}

/**
 * Delete a merchant mapping
 */
export async function deleteMerchantMapping(
  userId: string,
  merchantName: string
): Promise<boolean> {
  const pb = await createPocketbaseServerClient();
  const normalized = merchantName.toUpperCase();
  const list = await pb.collection("merchant_mappings").getList(1, 1, {
    filter: `user_id = "${userId}" && merchant_name = "${normalized}"`,
  });
  const record = list.items?.[0];
  if (!record) return false;

  await pb.collection("merchant_mappings").delete(record.id);

  return true;
}

/**
 * Update a merchant mapping category
 */
export async function updateMerchantMapping(
  userId: string,
  merchantName: string,
  newCategory: string
): Promise<boolean> {
  const pb = await createPocketbaseServerClient();
  const normalized = merchantName.toUpperCase();
  const list = await pb.collection("merchant_mappings").getList(1, 1, {
    filter: `user_id = "${userId}" && merchant_name = "${normalized}"`,
  });
  const record = list.items?.[0];
  if (!record) return false;

  await pb.collection("merchant_mappings").update(record.id, {
    category: newCategory,
  });

  return true;
}
