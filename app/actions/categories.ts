"use server";

import { updateTag } from "next/cache";
import { getPocketbaseServerAuth } from "@/lib/pocketbase/server";
import type {
  Category,
  CategoryDeleteOptions,
  CategoryDeleteResult,
  CategoryInsert,
  CategoryUpdate,
} from "@/lib/types/category";
import {
  categoryInsertSchema,
  categoryUpdateSchema,
  MAX_CATEGORIES_PER_USER,
} from "@/lib/types/category";

/**
 * Get all categories for the current user
 */
export async function getCategories(): Promise<Category[]> {
  const { pb, userId } = await getPocketbaseServerAuth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  const data = await pb.collection("categories").getFullList<Category>({
    filter: `user_id = "${userId}"`,
    sort: "name",
  });

  return data || [];
}

/**
 * Create a new category
 */
export async function createCategory(input: CategoryInsert): Promise<Category> {
  const { pb, userId } = await getPocketbaseServerAuth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate input
  const validatedInput = categoryInsertSchema.parse(input);

  // Check category limit
  const countResult = await pb.collection("categories").getList(1, 1, {
    filter: `user_id = "${userId}"`,
  });

  if (countResult.totalItems >= MAX_CATEGORIES_PER_USER) {
    throw new Error(`Maximum ${MAX_CATEGORIES_PER_USER} categories allowed`);
  }

  // Create category
  try {
    const data = await pb.collection("categories").create<Category>({
      user_id: userId,
      name: validatedInput.name,
      description: validatedInput.description || null,
      is_default: false,
    });

    updateTag("categories");
    return data;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create category";
    if (message.toLowerCase().includes("unique")) {
      throw new Error("Category with this name already exists");
    }
    throw new Error(`Failed to create category: ${message}`);
  }
}

/**
 * Update an existing category
 */
export async function updateCategory(
  categoryId: string,
  input: CategoryUpdate
): Promise<Category> {
  const { pb, userId } = await getPocketbaseServerAuth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate input
  const validatedInput = categoryUpdateSchema.parse(input);

  try {
    const data = await pb
      .collection("categories")
      .update<Category>(categoryId, {
        name: validatedInput.name,
        description: validatedInput.description || null,
      });

    const expenses = await pb.collection("expenses").getFullList({
      filter: `user_id = "${userId}" && category_id = "${categoryId}"`,
    });

    for (const expense of expenses) {
      await pb.collection("expenses").update(expense.id, {
        category: data.name,
        category_text: data.name,
      });
    }

    updateTag("categories");
    return data;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update category";
    if (message.toLowerCase().includes("unique")) {
      throw new Error("Category with this name already exists");
    }
    throw new Error(`Failed to update category: ${message}`);
  }
}

/**
 * Delete a category with optional expense reassignment
 */
export async function deleteCategory(
  categoryId: string,
  options?: CategoryDeleteOptions
): Promise<CategoryDeleteResult> {
  const { pb, userId } = await getPocketbaseServerAuth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  let reassignedCount = 0;
  let deletedCount = 0;

  if (options?.targetCategoryId) {
    const targetCategory = await pb
      .collection("categories")
      .getOne<Category>(options.targetCategoryId);

    const expensesToUpdate = await pb.collection("expenses").getFullList({
      filter: `user_id = "${userId}" && category_id = "${categoryId}"`,
    });

    for (const expense of expensesToUpdate) {
      await pb.collection("expenses").update(expense.id, {
        category_id: targetCategory.id,
        category: targetCategory.name,
        category_text: targetCategory.name,
      });
    }

    reassignedCount = expensesToUpdate.length;
  } else {
    const expensesToDelete = await pb.collection("expenses").getFullList({
      filter: `user_id = "${userId}" && category_id = "${categoryId}"`,
    });

    for (const expense of expensesToDelete) {
      await pb.collection("expenses").delete(expense.id);
    }

    deletedCount = expensesToDelete.length;
  }

  await pb.collection("categories").delete(categoryId);

  updateTag("categories");
  return {
    success: true,
    reassigned_count: reassignedCount,
    deleted_count: deletedCount,
  };
}

/**
 * Get count of expenses in a category
 */
export async function getCategoryExpenseCount(
  categoryId: string
): Promise<number> {
  const { pb, userId } = await getPocketbaseServerAuth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  const countResult = await pb.collection("expenses").getList(1, 1, {
    filter: `user_id = "${userId}" && category_id = "${categoryId}"`,
  });

  return countResult.totalItems;
}

/**
 * Get or create a category by name for the current user
 * This is used during expense processing to ensure categories exist
 */
export async function getOrCreateCategoryByName(
  categoryName: string,
  userId: string
): Promise<string> {
  const { pb } = await getPocketbaseServerAuth();

  const existingCategories = await pb.collection("categories").getFullList<{
    id: string;
    name: string;
  }>({
    filter: `user_id = "${userId}"`,
  });

  const match = existingCategories.find(
    (category) => category.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (match) {
    return match.id;
  }

  try {
    const created = await pb.collection("categories").create<{ id: string }>({
      user_id: userId,
      name: categoryName,
      is_default: false,
    });

    updateTag("categories");
    return created.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create category";
    throw new Error(`Failed to create category: ${message}`);
  }
}
