import { z } from "zod";

// Category schemas and types
export const categorySchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  name: z.string().min(1).max(50),
  description: z.string().nullable(),
  is_default: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const categoryInsertSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
});

export interface Category {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryInsert {
  name: string;
  description?: string;
}

export interface CategoryUpdate {
  name: string;
  description?: string;
}

export interface CategoryDeleteOptions {
  targetCategoryId?: string;
}

export interface CategoryDeleteResult {
  success: boolean;
  reassigned_count: number;
  deleted_count: number;
}

export type DatabaseCategoryRow = z.infer<typeof categorySchema>;

// Default categories for new users
export const DEFAULT_CATEGORIES = [
  { name: "Dining", description: "Restaurants, cafes, food delivery" },
  {
    name: "Groceries",
    description: "Supermarkets, grocery stores, food shopping",
  },
  {
    name: "Transportation",
    description: "Public transport, taxis, fuel, parking",
  },
  {
    name: "Shopping",
    description: "Retail, clothing, electronics, general merchandise",
  },
  {
    name: "Entertainment",
    description: "Movies, games, streaming, events, hobbies",
  },
  {
    name: "Bills & Utilities",
    description: "Utilities, phone, internet, insurance, subscriptions",
  },
  {
    name: "Healthcare",
    description: "Medical, dental, pharmacy, fitness, wellness",
  },
  {
    name: "Education",
    description: "Schools, courses, books, educational materials",
  },
  {
    name: "Travel",
    description: "Hotels, flights, foreign transactions, travel expenses",
  },
  { name: "Other", description: "Miscellaneous expenses" },
] as const;

export const MAX_CATEGORIES_PER_USER = 20;
