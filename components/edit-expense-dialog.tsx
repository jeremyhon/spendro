"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCategories } from "@/hooks/use-categories";
import type {
  DisplayExpenseWithDuplicate,
  ExpenseFormData,
} from "@/lib/types/expense";
import { CURRENCIES } from "@/lib/types/expense";
import { getMerchantCategoryMappingClient } from "@/lib/utils/merchant-mappings-client";

interface EditExpenseDialogProps {
  expense: DisplayExpenseWithDuplicate;
  onSave: (data: {
    description: string;
    merchant: string;
    category: string;
    amount: number;
    originalAmount: number;
    originalCurrency: string;
    date: string;
    applyToAllMerchant?: boolean;
  }) => Promise<{ success?: boolean; error?: string; updatedCount?: number }>;
  onClose: () => void;
}

export function EditExpenseDialog({
  expense,
  onSave,
  onClose,
}: EditExpenseDialogProps) {
  const [open, setOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showBulkUpdateOption, setShowBulkUpdateOption] = useState(false);
  const {
    categories,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useCategories();
  const [applyToAllMerchant, setApplyToAllMerchant] = useState(false);
  const [formData, setFormData] = useState<ExpenseFormData>({
    description: expense.description,
    merchant: expense.merchant,
    category: expense.category,
    amount: expense.amount.toString(),
    originalAmount: expense.originalAmount.toString(),
    originalCurrency: expense.originalCurrency,
    date: expense.date,
  });

  // Check if we should show bulk update option when category changes
  useEffect(() => {
    const checkMerchantMapping = async () => {
      const categoryChanged = formData.category !== expense.category;

      if (categoryChanged && formData.merchant.trim()) {
        try {
          const existingMapping = await getMerchantCategoryMappingClient(
            formData.merchant,
            formData.category
          );
          setShowBulkUpdateOption(!existingMapping);
        } catch (error) {
          console.error("Error checking merchant mapping:", error);
          setShowBulkUpdateOption(false);
        }
      } else {
        setShowBulkUpdateOption(false);
      }
    };

    checkMerchantMapping();
  }, [formData.category, formData.merchant, expense.category]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await onSave({
        description: formData.description,
        merchant: formData.merchant,
        category: formData.category,
        amount: Number.parseFloat(formData.amount),
        originalAmount: Number.parseFloat(formData.originalAmount),
        originalCurrency: formData.originalCurrency,
        date: formData.date,
        applyToAllMerchant: showBulkUpdateOption ? applyToAllMerchant : false,
      });

      if (result.success) {
        setOpen(false);
        onClose();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    // Reset form data to original values
    setFormData({
      description: expense.description,
      merchant: expense.merchant,
      category: expense.category,
      amount: expense.amount.toString(),
      originalAmount: expense.originalAmount.toString(),
      originalCurrency: expense.originalCurrency,
      date: expense.date,
    });
    setOpen(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>Edit Expense</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">
              Description
            </Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="merchant" className="text-right">
              Merchant
            </Label>
            <Input
              id="merchant"
              value={formData.merchant}
              onChange={(e) =>
                setFormData({ ...formData, merchant: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">
              Category
            </Label>
            <Select
              value={formData.category}
              onValueChange={(value) =>
                setFormData({ ...formData, category: value })
              }
            >
              <SelectTrigger className="col-span-3">
                <SelectValue
                  placeholder={
                    categoriesLoading
                      ? "Loading categories..."
                      : "Select a category"
                  }
                />
                {categoriesLoading && (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </SelectTrigger>
              <SelectContent>
                {categoriesLoading ? (
                  <SelectItem value="__loading__" disabled>
                    Loading categories...
                  </SelectItem>
                ) : categoriesError ? (
                  <SelectItem value="__error__" disabled>
                    Failed to load categories
                  </SelectItem>
                ) : categories.length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    No categories found
                  </SelectItem>
                ) : (
                  categories.map((category) => (
                    <SelectItem key={category.id} value={category.name}>
                      {category.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">
              Amount (SGD)
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) =>
                setFormData({ ...formData, amount: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="original-amount" className="text-right">
              Original Amount
            </Label>
            <Input
              id="original-amount"
              type="number"
              step="0.01"
              value={formData.originalAmount}
              onChange={(e) =>
                setFormData({ ...formData, originalAmount: e.target.value })
              }
              className="col-span-2"
            />
            <Select
              value={formData.originalCurrency}
              onValueChange={(value) =>
                setFormData({ ...formData, originalCurrency: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="date" className="text-right">
              Date
            </Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) =>
                setFormData({ ...formData, date: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          {showBulkUpdateOption && (
            <div className="grid grid-cols-4 items-center gap-4">
              <div className="col-span-1" />
              <div className="col-span-3 flex items-center space-x-2">
                <Checkbox
                  id="apply-to-all"
                  checked={applyToAllMerchant}
                  onCheckedChange={(checked) =>
                    setApplyToAllMerchant(checked === true)
                  }
                />
                <Label
                  htmlFor="apply-to-all"
                  className="text-sm font-normal cursor-pointer"
                >
                  Apply this category to all expenses from "{formData.merchant}"
                </Label>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
