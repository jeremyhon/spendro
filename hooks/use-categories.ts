"use client";

import { useCallback, useEffect, useState } from "react";
import { getCategories } from "@/app/actions/categories";
import type { Category } from "@/lib/types/category";

const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

type CategoriesCache = {
  data: Category[] | null;
  error: string | null;
  fetchedAt: number | null;
  promise: Promise<Category[]> | null;
};

const categoriesCache: CategoriesCache = {
  data: null,
  error: null,
  fetchedAt: null,
  promise: null,
};

const isCacheFresh = () =>
  categoriesCache.data &&
  categoriesCache.fetchedAt !== null &&
  Date.now() - categoriesCache.fetchedAt < CATEGORY_CACHE_TTL_MS;

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>(
    categoriesCache.data || []
  );
  const [isLoading, setIsLoading] = useState(!isCacheFresh());
  const [error, setError] = useState<string | null>(categoriesCache.error);

  const fetchCategories = useCallback(async (force = false) => {
    if (!force && isCacheFresh()) {
      setCategories(categoriesCache.data || []);
      setError(categoriesCache.error);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      if (!force && categoriesCache.promise) {
        const data = await categoriesCache.promise;
        setCategories(data);
        setError(categoriesCache.error);
        return;
      }

      const request = getCategories();
      categoriesCache.promise = request;

      const data = await request;
      categoriesCache.data = data;
      categoriesCache.error = null;
      categoriesCache.fetchedAt = Date.now();
      setCategories(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch categories";
      categoriesCache.error = message;
      categoriesCache.fetchedAt = Date.now();
      setError(message);
      console.error("Error fetching categories:", err);
    } finally {
      categoriesCache.promise = null;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const refresh = async () => {
    await fetchCategories(true);
  };

  return { categories, isLoading, error, refresh };
}
