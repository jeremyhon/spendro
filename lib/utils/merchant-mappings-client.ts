"use client";

import { pocketbase } from "@/lib/pocketbase/client";
import type { MerchantMapping } from "@/lib/types/expense";

/**
 * Client-side version: Get merchant mapping for a user (case-insensitive)
 */
export async function getMerchantMappingClient(
  merchantName: string
): Promise<MerchantMapping | null> {
  const normalized = merchantName.toUpperCase();
  const list = await pocketbase
    .collection("merchant_mappings")
    .getList<MerchantMapping>(1, 1, {
      filter: `merchant_name = "${normalized}"`,
    });

  return list.items?.[0] ?? null;
}

/**
 * Client-side version: Check if a specific merchant-category mapping exists
 */
export async function getMerchantCategoryMappingClient(
  merchantName: string,
  category: string
): Promise<MerchantMapping | null> {
  const normalized = merchantName.toUpperCase();
  const list = await pocketbase
    .collection("merchant_mappings")
    .getList<MerchantMapping>(1, 1, {
      filter: `merchant_name = "${normalized}" && category = "${category}"`,
    });

  return list.items?.[0] ?? null;
}
