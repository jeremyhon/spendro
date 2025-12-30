import { createPocketbaseServerClient } from "@/lib/pocketbase/server";

/**
 * Resolve category name to category ID for a user
 * If category doesn't exist, creates it and returns the ID
 */
export async function resolveCategoryNameToId(
  userId: string,
  categoryName: string
): Promise<string> {
  const pb = await createPocketbaseServerClient();

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

  const newCategory = await pb.collection("categories").create<{ id: string }>({
    user_id: userId,
    name: categoryName,
    is_default: false,
  });

  return newCategory.id;
}

/**
 * Get category ID for a user by name (without creating if not found)
 */
export async function getCategoryIdByName(
  userId: string,
  categoryName: string
): Promise<string | null> {
  const pb = await createPocketbaseServerClient();

  const categories = await pb.collection("categories").getFullList<{
    id: string;
    name: string;
  }>({
    filter: `user_id = "${userId}"`,
  });

  const match = categories.find(
    (category) => category.name.toLowerCase() === categoryName.toLowerCase()
  );

  return match?.id ?? null;
}
