"use client";

import { Filter, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { ExpenseFilters } from "@/hooks/use-expenses";
import { EXPENSE_CATEGORIES } from "@/lib/types/expense";

interface ExpenseColumnFiltersProps {
  filters: ExpenseFilters;
  onFiltersChange: (filters: ExpenseFilters) => void;
  availableMerchants: string[];
  amountRange: { min: number; max: number };
}

export function ExpenseColumnFilters({
  filters,
  onFiltersChange,
  availableMerchants,
  amountRange,
}: ExpenseColumnFiltersProps) {
  const [localAmountRange, setLocalAmountRange] = useState<[number, number]>([
    filters.amountRange?.min ?? amountRange.min,
    filters.amountRange?.max ?? amountRange.max,
  ]);

  const hasActiveFilters =
    filters.categories?.length ||
    filters.merchants?.length ||
    filters.amountRange ||
    filters.searchText?.trim();

  const handleClearFilters = () => {
    onFiltersChange({});
    setLocalAmountRange([amountRange.min, amountRange.max]);
  };

  const handleSearchChange = (value: string) => {
    onFiltersChange({
      ...filters,
      searchText: value,
    });
  };

  const handleCategoryChange = (category: string) => {
    const categories = filters.categories || [];
    const newCategories = categories.includes(category)
      ? categories.filter((c) => c !== category)
      : [...categories, category];

    onFiltersChange({
      ...filters,
      categories: newCategories.length > 0 ? newCategories : undefined,
    });
  };

  const handleMerchantChange = (merchant: string) => {
    const merchants = filters.merchants || [];
    const newMerchants = merchants.includes(merchant)
      ? merchants.filter((m) => m !== merchant)
      : [...merchants, merchant];

    onFiltersChange({
      ...filters,
      merchants: newMerchants.length > 0 ? newMerchants : undefined,
    });
  };

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

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search Filter */}
      <div className="flex items-center space-x-2">
        <Input
          placeholder="Search expenses..."
          value={filters.searchText || ""}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-8 w-[150px] lg:w-[250px]"
        />
      </div>

      {/* Category Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <Filter className="mr-2 h-4 w-4" />
            Category
            {filters.categories?.length && (
              <Badge
                variant="secondary"
                className="ml-2 rounded-sm px-1 font-normal"
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

      {/* Merchant Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <Filter className="mr-2 h-4 w-4" />
            Merchant
            {filters.merchants?.length && (
              <Badge
                variant="secondary"
                className="ml-2 rounded-sm px-1 font-normal"
              >
                {filters.merchants.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0" align="start">
          <div className="p-3">
            <Label className="text-sm font-medium">Merchants</Label>
            <div className="mt-2 max-h-[200px] overflow-y-auto space-y-2">
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
                    className="text-sm font-normal truncate"
                    title={merchant}
                  >
                    {merchant}
                  </Label>
                </div>
              ))}
              {availableMerchants.length > 20 && (
                <div className="text-xs text-muted-foreground">
                  +{availableMerchants.length - 20} more merchants
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Amount Range Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <Filter className="mr-2 h-4 w-4" />
            Amount
            {filters.amountRange && (
              <Badge
                variant="secondary"
                className="ml-2 rounded-sm px-1 font-normal"
              >
                ${filters.amountRange.min}-${filters.amountRange.max}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="p-3">
            <Label className="text-sm font-medium">Amount Range (SGD)</Label>
            <div className="mt-4 space-y-4">
              <Slider
                value={localAmountRange}
                onValueChange={handleAmountRangeChange}
                min={amountRange.min}
                max={amountRange.max}
                step={1}
                className="w-full"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>${localAmountRange[0]}</span>
                <span>${localAmountRange[1]}</span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          onClick={handleClearFilters}
          className="h-8 px-2 lg:px-3"
        >
          Reset
          <X className="ml-2 h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
