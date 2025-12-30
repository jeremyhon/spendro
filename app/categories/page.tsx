import { redirect } from "next/navigation";
import { getCategories } from "@/app/actions/categories";
import { getPocketbaseServerAuth } from "@/lib/pocketbase/server";
import { CategoriesClient } from "./categories-client";

export default async function CategoriesPage() {
  const { user } = await getPocketbaseServerAuth();

  if (!user) {
    redirect("/login");
  }

  const categories = await getCategories();

  return <CategoriesClient initialCategories={categories} />;
}
