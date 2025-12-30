"use server";

import { revalidatePath } from "next/cache";
import { getPocketbaseServerAuth } from "@/lib/pocketbase/server";
import type { MerchantMapping } from "@/lib/types/expense";
import {
  createMerchantMapping,
  deleteMerchantMapping,
  listUserMerchantMappings,
  updateMerchantMapping,
} from "@/lib/utils/merchant-mappings";

/**
 * Get all merchant mappings for the authenticated user
 */
export async function getMerchantMappings(): Promise<{
  mappings?: MerchantMapping[];
  error?: string;
}> {
  const { userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  try {
    const mappings = await listUserMerchantMappings(userId);
    return { mappings };
  } catch (error) {
    console.error("Error fetching merchant mappings:", error);
    return { error: "Failed to fetch merchant mappings" };
  }
}

/**
 * Create a new merchant mapping
 */
export async function createMerchantMappingAction(
  merchantName: string,
  category: string
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  if (!merchantName.trim() || !category.trim()) {
    return { error: "Merchant name and category are required" };
  }

  try {
    const success = await createMerchantMapping(
      userId,
      merchantName.trim(),
      category
    );

    if (!success) {
      return { error: "Merchant mapping already exists" };
    }

    revalidatePath("/merchant-mappings");
    return { success: true };
  } catch (error) {
    console.error("Error creating merchant mapping:", error);
    return { error: "Failed to create merchant mapping" };
  }
}

/**
 * Update an existing merchant mapping
 */
export async function updateMerchantMappingAction(
  merchantName: string,
  newCategory: string
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  if (!newCategory.trim()) {
    return { error: "Category is required" };
  }

  try {
    const success = await updateMerchantMapping(
      userId,
      merchantName,
      newCategory
    );

    if (!success) {
      return { error: "Failed to update merchant mapping" };
    }

    revalidatePath("/merchant-mappings");
    return { success: true };
  } catch (error) {
    console.error("Error updating merchant mapping:", error);
    return { error: "Failed to update merchant mapping" };
  }
}

/**
 * Delete a merchant mapping
 */
export async function deleteMerchantMappingAction(
  merchantName: string
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await getPocketbaseServerAuth();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  try {
    const success = await deleteMerchantMapping(userId, merchantName);

    if (!success) {
      return { error: "Failed to delete merchant mapping" };
    }

    revalidatePath("/merchant-mappings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting merchant mapping:", error);
    return { error: "Failed to delete merchant mapping" };
  }
}
