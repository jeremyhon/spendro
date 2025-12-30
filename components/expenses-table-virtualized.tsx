"use client";

import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Filter, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ExpenseFilters } from "@/hooks/use-expenses";
import type { DisplayExpenseWithDuplicate } from "@/lib/types/expense";
import { ExpenseBulkActions } from "./expense-bulk-actions";
import { ExpenseColumnVisibility } from "./expense-column-visibility";
import {
  AmountInlineFilter,
  CategoryInlineFilter,
  MerchantInlineFilter,
} from "./expense-inline-filters";
import { createExpenseColumns } from "./expenses-table-columns";

interface ExpenseCardProps {
  expense: DisplayExpenseWithDuplicate;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: (expense: DisplayExpenseWithDuplicate) => void;
}

function ExpenseCard({
  expense,
  isSelected,
  onToggleSelect,
  onEdit,
}: ExpenseCardProps) {
  return (
    <Card
      className={`transition-colors ${isSelected ? "bg-muted/50 border-primary" : ""}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              aria-label="Select expense"
            />
            <Badge variant="outline" className="text-xs">
              {expense.category}
            </Badge>
          </div>
          <div className="text-right">
            <div className="font-semibold">
              {expense.amount.toLocaleString("en-US", {
                style: "currency",
                currency: "SGD",
              })}
            </div>
            {expense.originalCurrency !== "SGD" && (
              <div className="text-xs text-muted-foreground">
                {expense.originalAmount.toLocaleString("en-US", {
                  style: "currency",
                  currency: expense.originalCurrency,
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1 mb-3">
          <div className="font-medium text-sm">{expense.merchant}</div>
          <div className="text-xs text-muted-foreground truncate">
            {expense.description}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{expense.date}</div>
          <div className="flex items-center gap-2">
            {expense.isDuplicate && (
              <Badge variant="secondary" className="text-xs">
                Duplicate
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(expense)}
              className="h-6 w-6 p-0"
            >
              <Pencil className="h-3 w-3" />
              <span className="sr-only">Edit expense</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MobileControlsProps {
  filters: ExpenseFilters;
  onFiltersChange: (filters: ExpenseFilters) => void;
}

function MobileControls({ filters, onFiltersChange }: MobileControlsProps) {
  const handleSortChange = (value: string) => {
    const [field, direction] = value.split("-");
    onFiltersChange({
      ...filters,
      sortBy: field as "date" | "amount" | "merchant",
      sortDirection: direction as "asc" | "desc",
    });
  };

  const currentSort =
    filters.sortBy && filters.sortDirection
      ? `${filters.sortBy}-${filters.sortDirection}`
      : "date-desc";

  return (
    <div className="flex gap-2 mb-4">
      <Input
        placeholder="Search expenses..."
        value={filters.searchText || ""}
        onChange={(e) =>
          onFiltersChange({ ...filters, searchText: e.target.value })
        }
        className="flex-1 h-9"
      />

      <Select value={currentSort} onValueChange={handleSortChange}>
        <SelectTrigger className="w-32 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="date-desc">Date ↓</SelectItem>
          <SelectItem value="date-asc">Date ↑</SelectItem>
          <SelectItem value="amount-desc">Amount ↓</SelectItem>
          <SelectItem value="amount-asc">Amount ↑</SelectItem>
          <SelectItem value="merchant-asc">Merchant ↑</SelectItem>
          <SelectItem value="merchant-desc">Merchant ↓</SelectItem>
        </SelectContent>
      </Select>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <Filter className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filter Expenses</SheetTitle>
            <SheetDescription>
              Filter your expenses by category, merchant, and amount.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            {/* Filter content will go here */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Categories</div>
              {/* Category checkboxes */}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Merchants</div>
              {/* Merchant checkboxes */}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Amount Range</div>
              {/* Amount slider */}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface ExpensesTableVirtualizedProps {
  expenses: DisplayExpenseWithDuplicate[];
  onEdit: (expense: DisplayExpenseWithDuplicate) => void;
  onBulkDelete: (expenseIds: string[]) => void;
  filters: ExpenseFilters;
  onFiltersChange: (filters: ExpenseFilters) => void;
  loading?: boolean;
}

export function ExpensesTableVirtualized({
  expenses,
  onEdit,
  onBulkDelete,
  filters,
  onFiltersChange,
  loading = false,
}: ExpensesTableVirtualizedProps) {
  // ALL HOOKS MUST BE CALLED FIRST - BEFORE ANY CONDITIONAL LOGIC

  // Responsive breakpoint hook - only re-renders when crossing 640px threshold
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const handleResize = () => {
      const newIsMobile = window.innerWidth < 640;
      if (newIsMobile !== isMobile) {
        setIsMobile(newIsMobile);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  // Desktop table state (always called, even on mobile)
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // Get available merchants for filtering
  const availableMerchants = useMemo(() => {
    const merchants = Array.from(
      new Set(expenses.map((expense) => expense.merchant))
    );
    return merchants.filter(Boolean).sort();
  }, [expenses]);

  // Get amount range for filtering
  const amountRange = useMemo(() => {
    if (expenses.length === 0) return { min: 0, max: 1000 };
    const amounts = expenses.map((expense) => expense.amount);
    return {
      min: Math.floor(Math.min(...amounts)),
      max: Math.ceil(Math.max(...amounts)),
    };
  }, [expenses]);

  const columns = useMemo(() => createExpenseColumns({ onEdit }), [onEdit]);

  const table = useReactTable({
    data: expenses,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    enableRowSelection: true,
    enableMultiRowSelection: true,
  });

  // Virtual scrolling setup
  const parentRef = useMemo(
    () => ({ current: null as HTMLDivElement | null }),
    []
  );

  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  const selectedRowCount = table.getFilteredSelectedRowModel().rows.length;

  // NOW WE CAN DO CONDITIONAL LOGIC

  if (loading) {
    return (
      <div className="h-full flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-[250px] bg-muted animate-pulse rounded" />
          <div className="h-8 w-[100px] bg-muted animate-pulse rounded" />
        </div>
        <div className="border rounded-md flex-1">
          <div className="h-full bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="h-full flex flex-col space-y-4">
        <MobileControls filters={filters} onFiltersChange={onFiltersChange} />
        <div className="space-y-3">
          {expenses.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No expenses found matching your filters.
            </div>
          ) : (
            expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                isSelected={false}
                onToggleSelect={() => {}}
                onEdit={onEdit}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  // Desktop Layout - Event Handlers

  const handleBulkDelete = async () => {
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const expenseIds = selectedRows.map((row) => row.original.id);

    setIsDeletingBulk(true);
    try {
      await onBulkDelete(expenseIds);
      setRowSelection({});
    } finally {
      setIsDeletingBulk(false);
    }
  };

  const handleClearSelection = () => {
    setRowSelection({});
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-[250px] bg-muted animate-pulse rounded" />
          <div className="h-8 w-[100px] bg-muted animate-pulse rounded" />
        </div>
        <div className="border rounded-md flex-1">
          <div className="h-full bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  const handleSearchChange = (value: string) => {
    onFiltersChange({
      ...filters,
      searchText: value,
    });
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Search and Controls */}
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search expenses..."
          value={filters.searchText || ""}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-8 w-[250px]"
        />
        <ExpenseColumnVisibility table={table} />
      </div>

      {/* Desktop Table */}
      <div className="border rounded-md flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className="flex">
              {headerGroup.headers.map((header) => (
                <div
                  key={header.id}
                  className={`px-4 py-3 text-left text-sm font-medium text-muted-foreground ${getHeaderClassName(header.id)} flex items-center gap-2`}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  {/* Inline Filters */}
                  {header.column.id === "category" && (
                    <CategoryInlineFilter
                      filters={filters}
                      onFiltersChange={onFiltersChange}
                    />
                  )}
                  {header.column.id === "merchant" && (
                    <MerchantInlineFilter
                      filters={filters}
                      onFiltersChange={onFiltersChange}
                      availableMerchants={availableMerchants}
                    />
                  )}
                  {header.column.id === "amount" && (
                    <AmountInlineFilter
                      filters={filters}
                      onFiltersChange={onFiltersChange}
                      amountRange={amountRange}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Virtualized Table Body */}
        <div
          ref={parentRef}
          className="flex-1 overflow-auto"
          style={{
            contain: "strict",
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {table.getRowModel().rows.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">
                No expenses found matching your filters.
              </div>
            ) : (
              virtualizer.getVirtualItems().map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    className={`flex border-b ${
                      row.getIsSelected() ? "bg-muted/50" : "hover:bg-muted/50"
                    }`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className={`px-4 ${getCellClassName(cell.column.id)}`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      <ExpenseBulkActions
        selectedCount={selectedRowCount}
        onBulkDelete={handleBulkDelete}
        onClearSelection={handleClearSelection}
        isDeleting={isDeletingBulk}
      />

      {/* Table Info */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedRowCount > 0 ? (
            <>
              {selectedRowCount} of {table.getFilteredRowModel().rows.length}{" "}
              row(s) selected
            </>
          ) : (
            <>
              Showing {table.getFilteredRowModel().rows.length} of{" "}
              {expenses.length} expenses
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Base column configuration
function getColumnConfig(columnId: string) {
  switch (columnId) {
    case "select":
      return {
        base: "w-[40px] flex-shrink-0",
        header: "",
        cell: "",
      };
    case "date":
      return {
        base: "hidden md:flex w-[135px] flex-shrink-0",
        header: "",
        cell: "",
      };
    case "merchant":
      return {
        base: "hidden sm:flex sm:flex-1 sm:min-w-0 lg:w-[180px] lg:flex-shrink-0",
        header: "",
        cell: "text-muted-foreground text-xs",
      };
    case "category":
      return {
        base: "w-[140px] flex-shrink-0",
        header: "",
        cell: "",
      };
    case "originalAmount":
      return {
        base: "text-right hidden xl:flex w-[160px] flex-shrink-0",
        header: "",
        cell: "text-muted-foreground",
      };
    case "description":
      return {
        base: "hidden lg:flex lg:flex-1 lg:min-w-0",
        header: "",
        cell: "font-normal",
      };
    case "createdAt":
      return {
        base: "hidden xl:flex w-[120px] flex-shrink-0",
        header: "",
        cell: "",
      };
    case "amount":
      return {
        base: "text-right w-[140px] lg:w-[160px] flex-shrink-0",
        header: "",
        cell: "",
      };
    case "actions":
      return {
        base: "w-[50px] flex-shrink-0",
        header: "",
        cell: "",
      };
    default:
      return {
        base: "",
        header: "",
        cell: "",
      };
  }
}

function getHeaderClassName(columnId: string): string {
  const config = getColumnConfig(columnId);
  return `${config.base} ${config.header}`.trim();
}

function getCellClassName(columnId: string): string {
  const config = getColumnConfig(columnId);
  return `${config.base} ${config.cell}`.trim();
}
