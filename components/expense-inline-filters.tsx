"use client";

import { Filter } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { ExpenseFilters } from "@/hooks/use-expenses";
import { EXPENSE_CATEGORIES } from "@/lib/types/expense";

interface BaseInlineFilterProps {
  filters: ExpenseFilters;
  onFiltersChange: (filters: ExpenseFilters) => void;
}

interface CategoryFilterProps extends BaseInlineFilterProps {}

export function CategoryInlineFilter({
  filters,
  onFiltersChange,
}: CategoryFilterProps) {
  const handleCategoryChange = (category: string) => {
    const currentCategories = filters.categories || [];
    const newCategories = currentCategories.includes(category)
      ? currentCategories.filter((c) => c !== category)
      : [...currentCategories, category];

    onFiltersChange({
      ...filters,
      categories: newCategories.length > 0 ? newCategories : undefined,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-muted-foreground hover:text-foreground"
        >
          <Filter className="h-3 w-3" />
          {filters.categories?.length && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 rounded-sm px-1 text-xs font-normal"
            >
              {filters.categories.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <div className="p-3">
          <Label className="text-sm font-medium">Categories</Label>
          <div className="mt-2 space-y-2">
            {EXPENSE_CATEGORIES.map((category) => (
              <div key={category} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`category-${category}`}
                  checked={filters.categories?.includes(category) || false}
                  onChange={() => handleCategoryChange(category)}
                  className="rounded border-gray-300"
                />
                <Label
                  htmlFor={`category-${category}`}
                  className="text-sm font-normal"
                >
                  {category}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MerchantFilterProps extends BaseInlineFilterProps {
  availableMerchants: string[];
}

export function MerchantInlineFilter({
  filters,
  onFiltersChange,
  availableMerchants,
}: MerchantFilterProps) {
  const handleMerchantChange = (merchant: string) => {
    const currentMerchants = filters.merchants || [];
    const newMerchants = currentMerchants.includes(merchant)
      ? currentMerchants.filter((m) => m !== merchant)
      : [...currentMerchants, merchant];

    onFiltersChange({
      ...filters,
      merchants: newMerchants.length > 0 ? newMerchants : undefined,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-muted-foreground hover:text-foreground"
        >
          <Filter className="h-3 w-3" />
          {filters.merchants?.length && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 rounded-sm px-1 text-xs font-normal"
            >
              {filters.merchants.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <div className="p-3">
          <Label className="text-sm font-medium">Merchants</Label>
          <div className="mt-2 max-h-[200px] space-y-2 overflow-y-auto">
            {availableMerchants.slice(0, 20).map((merchant) => (
              <div key={merchant} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`merchant-${merchant}`}
                  checked={filters.merchants?.includes(merchant) || false}
                  onChange={() => handleMerchantChange(merchant)}
                  className="rounded border-gray-300"
                />
                <Label
                  htmlFor={`merchant-${merchant}`}
                  className="text-sm font-normal"
                >
                  {merchant}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface AmountFilterProps extends BaseInlineFilterProps {
  amountRange: { min: number; max: number };
}

export function AmountInlineFilter({
  filters,
  onFiltersChange,
  amountRange,
}: AmountFilterProps) {
  const [localAmountRange, setLocalAmountRange] = useState<[number, number]>([
    filters.amountRange?.min ?? amountRange.min,
    filters.amountRange?.max ?? amountRange.max,
  ]);

  const handleAmountRangeChange = (value: [number, number]) => {
    setLocalAmountRange(value);
    onFiltersChange({
      ...filters,
      amountRange: {
        min: value[0],
        max: value[1],
      },
    });
  };

  const hasActiveFilter =
    filters.amountRange &&
    (filters.amountRange.min !== amountRange.min ||
      filters.amountRange.max !== amountRange.max);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-muted-foreground hover:text-foreground"
        >
          <Filter className="h-3 w-3" />
          {hasActiveFilter && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 rounded-sm px-1 text-xs font-normal"
            >
              1
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <div className="p-3">
          <Label className="text-sm font-medium">Amount Range (SGD)</Label>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Slider
                value={localAmountRange}
                onValueChange={handleAmountRangeChange}
                max={amountRange.max}
                min={amountRange.min}
                step={1}
                className="w-full"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>SGD {localAmountRange[0]}</span>
                <span>SGD {localAmountRange[1]}</span>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
