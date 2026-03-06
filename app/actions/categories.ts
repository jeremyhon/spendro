"use server";

import { updateTag } from "next/cache";
import {
  createLocalCategory,
  deleteLocalCategory,
  getLocalCategoryExpenseCount,
  getOrCreateLocalCategoryByName,
  listLocalCategories,
  updateLocalCategory,
} from "@/lib/local/web-adapter";
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

export async function getCategories(): Promise<Category[]> {
  return listLocalCategories();
}

export async function createCategory(input: CategoryInsert): Promise<Category> {
  const validatedInput = categoryInsertSchema.parse(input);
  const existing = listLocalCategories();
  if (existing.length >= MAX_CATEGORIES_PER_USER) {
    throw new Error(`Maximum ${MAX_CATEGORIES_PER_USER} categories allowed`);
  }

  const created = createLocalCategory(validatedInput);
  updateTag("categories");
  return created;
}

export async function updateCategory(
  categoryId: string,
  input: CategoryUpdate
): Promise<Category> {
  const validatedInput = categoryUpdateSchema.parse(input);
  const updated = updateLocalCategory(categoryId, validatedInput);
  updateTag("categories");
  return updated;
}

export async function deleteCategory(
  categoryId: string,
  options?: CategoryDeleteOptions
): Promise<CategoryDeleteResult> {
  const result = deleteLocalCategory(categoryId, options);
  updateTag("categories");
  return result;
}

export async function getCategoryExpenseCount(
  categoryId: string
): Promise<number> {
  return getLocalCategoryExpenseCount(categoryId);
}

export async function getOrCreateCategoryByName(
  categoryName: string,
  _userId: string
): Promise<string> {
  return getOrCreateLocalCategoryByName(categoryName);
}
