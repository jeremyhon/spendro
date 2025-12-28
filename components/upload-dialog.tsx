"use client";

import {
  CheckCircle2,
  ChevronLeft,
  FileIcon,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { deleteExpense } from "@/app/actions/expense";
import { uploadStatement } from "@/app/actions/upload";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useStatementStatus } from "@/hooks/use-statement-status";
import { useToast } from "@/hooks/use-toast";
import { useUploadExpenses } from "@/hooks/use-upload-expenses";
import type { DisplayExpenseWithDuplicate } from "@/lib/types/expense";
import { UploadExpenseEditor } from "./upload-expense-editor";
import { UploadExpensesList } from "./upload-expenses-list";

interface UploadDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

type FileUpload = {
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  message?: string;
  statementId?: string;
};

type UploadState = "upload" | "processing" | "review";

export function UploadDialog({ isOpen, onOpenChange }: UploadDialogProps) {
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [selectedExpense, setSelectedExpense] =
    useState<DisplayExpenseWithDuplicate | null>(null);
  const [recentlyEditedIds, setRecentlyEditedIds] = useState<Set<string>>(
    new Set()
  );
  const [isUploadPanelCollapsed, setIsUploadPanelCollapsed] = useState(false);
  const { toast } = useToast();

  // Memoize statement IDs to prevent recreation on every render
  const statementIds = useMemo(() => {
    const ids = uploads
      .filter((u) => u.status === "success" && u.statementId)
      .map((u) => u.statementId)
      .filter((id): id is string => Boolean(id));
    return ids;
  }, [uploads]);

  const { expenses, updateExpense, expenseCount } =
    useUploadExpenses(statementIds);

  // Use Electric SQL for real-time statement status tracking
  const { statements: statementStatuses } = useStatementStatus({
    statementIds,
    autoSubscribe: statementIds.length > 0,
  });

  // Create a key for resetting components when statement IDs change
  const componentKey = statementIds.join(",");

  // Compute upload state with Electric SQL status integration
  const uploadState = useMemo<UploadState>(() => {
    const isUploading = uploads.some((u) => u.status === "uploading");
    const hasSuccessfulUploads = uploads.some((u) => u.status === "success");

    // Check if any statements are still processing via Electric SQL
    const isProcessingStatements = statementStatuses.some(
      (statement) => statement.status === "processing"
    );

    if (isUploading || isProcessingStatements) return "processing";
    if (hasSuccessfulUploads || expenseCount > 0) return "review";
    return "upload";
  }, [uploads, expenseCount, statementStatuses]);

  // Clear state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setUploads([]);
      setSelectedExpense(null);
      setRecentlyEditedIds(new Set());
      setIsUploadPanelCollapsed(false);
    }
  }, [isOpen]);

  const handleUpload = useCallback(
    async (file: File) => {
      const fileId = file.name;
      setUploads((prev) =>
        prev.map((u) =>
          u.file.name === fileId
            ? { ...u, status: "uploading", progress: 50 }
            : u
        )
      );

      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadStatement(formData);

      setUploads((prev) =>
        prev.map((u) =>
          u.file.name === fileId
            ? {
                ...u,
                status: result.success ? "success" : "error",
                progress: 100,
                message: result.message,
                statementId: result.statementId,
              }
            : u
        )
      );

      toast({
        title: result.success ? "Upload Status" : "Upload Error",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    },
    [toast]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newUploads: FileUpload[] = acceptedFiles.map((file) => ({
        file,
        status: "pending",
        progress: 0,
      }));
      setUploads((prev) => [...prev, ...newUploads]);

      // Auto-upload dropped files
      acceptedFiles.forEach((file) => {
        void handleUpload(file);
      });
    },
    [handleUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
  });

  const removeFile = (fileName: string) => {
    setUploads((prev) => prev.filter((u) => u.file.name !== fileName));
  };

  const startUploads = () => {
    uploads
      .filter((u) => u.status === "pending")
      .forEach((u) => {
        void handleUpload(u.file);
      });
  };

  const handleSelectExpense = (expense: DisplayExpenseWithDuplicate) => {
    setSelectedExpense(expense);
  };

  const handleUpdateExpense = async (data: {
    description: string;
    merchant: string;
    category: string;
    amount: number;
    originalAmount: number;
    originalCurrency: string;
    date: string;
  }) => {
    if (!selectedExpense) return { error: "No expense selected" };

    const result = await updateExpense(selectedExpense.id, data);
    if (result.success) {
      setRecentlyEditedIds((prev) => new Set(prev).add(selectedExpense.id));
    }
    return result;
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const result = await deleteExpense(expenseId);
    if (result.success) {
      // Remove from recently edited if it was there
      setRecentlyEditedIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(expenseId);
        return newSet;
      });
      toast({
        title: "Expense Deleted",
        description: "The expense has been successfully deleted.",
      });
    } else {
      toast({
        title: "Delete Failed",
        description: result.error || "Failed to delete expense.",
        variant: "destructive",
      });
    }
    return result;
  };

  const handleClearSelection = () => {
    setSelectedExpense(null);
  };

  // Helper function to get Electric SQL status for a file upload
  const getElectricStatus = (upload: FileUpload) => {
    if (!upload.statementId) return null;
    return statementStatuses.find((s) => s.id === upload.statementId);
  };

  // Enhanced status display that combines upload status with Electric SQL status
  const getEnhancedStatus = (upload: FileUpload) => {
    const electricStatus = getElectricStatus(upload);

    if (upload.status === "uploading") {
      return { text: "Uploading...", variant: "default" as const };
    }

    if (upload.status === "error") {
      return {
        text: upload.message || "Upload failed",
        variant: "destructive" as const,
      };
    }

    if (upload.status === "success" && electricStatus) {
      switch (electricStatus.status) {
        case "processing":
          return { text: "AI processing...", variant: "default" as const };
        case "completed":
          return { text: "Processing complete", variant: "success" as const };
        case "failed":
          return { text: "Processing failed", variant: "destructive" as const };
        default:
          return {
            text: upload.message || "Uploaded",
            variant: "default" as const,
          };
      }
    }

    return {
      text: upload.message || upload.status,
      variant: "default" as const,
    };
  };

  const getDialogTitle = () => {
    switch (uploadState) {
      case "upload":
        return "Upload Statements";
      case "processing":
        return "Processing Statements";
      case "review":
        return `Review Expenses (${expenseCount} found)`;
      default:
        return "Upload Statements";
    }
  };

  const getDialogDescription = () => {
    switch (uploadState) {
      case "upload":
        return "Drag and drop your PDF bank statements here or click to select files.";
      case "processing": {
        const processingCount = statementStatuses.filter(
          (s) => s.status === "processing"
        ).length;
        const totalCount = statementStatuses.length;
        if (processingCount > 0) {
          return `AI is extracting expenses from ${processingCount} of ${totalCount} statements. This may take a moment.`;
        }
        return "AI is extracting expenses from your statements. This may take a moment.";
      }
      case "review":
        return "Review and edit the extracted expenses before completing the upload.";
      default:
        return "Drag and drop your PDF bank statements here or click to select files.";
    }
  };

  // Show compact dialog for initial upload state
  if (uploadState === "upload") {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{getDialogTitle()}</DialogTitle>
            <DialogDescription>{getDialogDescription()}</DialogDescription>
          </DialogHeader>

          <div
            {...getRootProps()}
            className={`mt-4 border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              {isDragActive
                ? "Drop the files here ..."
                : "Drag 'n' drop some files here, or click to select files"}
            </p>
          </div>

          {uploads.length > 0 && (
            <div className="mt-4 space-y-4 max-h-60 overflow-y-auto">
              {uploads.map((upload) => {
                const enhancedStatus = getEnhancedStatus(upload);
                const electricStatus = getElectricStatus(upload);
                const showProgress =
                  upload.status === "uploading" ||
                  (upload.status === "success" &&
                    electricStatus?.status === "processing");

                return (
                  <div
                    key={upload.file.name}
                    className="flex items-center gap-4"
                  >
                    <FileIcon className="h-8 w-8 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-sm font-medium truncate">
                        {upload.file.name}
                      </p>
                      {showProgress ? (
                        <div className="space-y-1">
                          <Progress
                            value={upload.progress}
                            className="h-2 mt-1"
                          />
                          <p className="text-xs text-muted-foreground">
                            {enhancedStatus.text}
                          </p>
                        </div>
                      ) : (
                        <p
                          className={`text-xs ${
                            enhancedStatus.variant === "destructive"
                              ? "text-destructive"
                              : enhancedStatus.variant === "success"
                                ? "text-green-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {enhancedStatus.text}
                        </p>
                      )}
                    </div>
                    {upload.status === "success" &&
                      electricStatus?.status === "completed" && (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      )}
                    {(upload.status === "pending" ||
                      upload.status === "error") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeFile(upload.file.name)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={startUploads}
              disabled={uploads.every((u) => u.status !== "pending")}
            >
              Upload
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Show expanded dialog for processing and review states
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[90vh] max-h-[900px] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left Panel - File Upload (Collapsible) */}
          {!isUploadPanelCollapsed && (
            <div className="w-[300px] lg:w-[320px] flex-shrink-0 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-sm font-medium">Upload Files</h3>
                {uploadState === "review" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsUploadPanelCollapsed(true)}
                    className="h-6 px-2"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors flex-shrink-0 ${
                  isDragActive
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {isDragActive
                    ? "Drop the files here..."
                    : "Drag files here or click to select"}
                </p>
              </div>

              {uploads.length > 0 && (
                <div className="space-y-2 flex-1 min-h-0 overflow-y-auto mt-4">
                  {uploads.map((upload) => {
                    const enhancedStatus = getEnhancedStatus(upload);
                    const electricStatus = getElectricStatus(upload);
                    const showProgress =
                      upload.status === "uploading" ||
                      (upload.status === "success" &&
                        electricStatus?.status === "processing");

                    return (
                      <div
                        key={upload.file.name}
                        className="flex items-center gap-2"
                      >
                        <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {upload.file.name}
                          </p>
                          {showProgress ? (
                            <div className="space-y-1">
                              <Progress
                                value={upload.progress}
                                className="h-1 mt-1"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                {enhancedStatus.text}
                              </p>
                            </div>
                          ) : (
                            <p
                              className={`text-[10px] ${
                                enhancedStatus.variant === "destructive"
                                  ? "text-destructive"
                                  : enhancedStatus.variant === "success"
                                    ? "text-green-600"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {enhancedStatus.text}
                            </p>
                          )}
                        </div>
                        {upload.status === "success" &&
                          electricStatus?.status === "completed" && (
                            <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                          )}
                        {(upload.status === "pending" ||
                          upload.status === "error") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 flex-shrink-0"
                            onClick={() => removeFile(upload.file.name)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {uploads.some((u) => u.status === "pending") && (
                <Button
                  onClick={startUploads}
                  className="w-full text-xs h-8 mt-4 flex-shrink-0"
                >
                  Start Upload
                </Button>
              )}
            </div>
          )}

          {/* Collapsed Upload Panel Toggle */}
          {isUploadPanelCollapsed && uploadState === "review" && (
            <div className="flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsUploadPanelCollapsed(false)}
                className="h-8 px-3"
              >
                <ChevronLeft className="h-3 w-3 rotate-180 mr-1" />
                Files
              </Button>
            </div>
          )}

          {/* Center Panel - Expenses List */}
          <div className="flex-1 min-w-0">
            <UploadExpensesList
              key={componentKey}
              expenses={expenses}
              selectedExpenseId={selectedExpense?.id}
              onSelectExpense={handleSelectExpense}
              recentlyEditedIds={recentlyEditedIds}
            />
          </div>

          {/* Right Panel - Expense Editor */}
          {selectedExpense && (
            <div className="w-[320px] lg:w-[360px] flex-shrink-0 flex flex-col min-h-0">
              <div className="border-l pl-4 flex-1 min-h-0">
                <UploadExpenseEditor
                  key={selectedExpense.id}
                  expense={selectedExpense}
                  onSave={handleUpdateExpense}
                  onDelete={handleDeleteExpense}
                  onCancel={handleClearSelection}
                  onClear={handleClearSelection}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
          <div className="text-sm text-muted-foreground">
            {uploadState === "review" && expenseCount > 0 && (
              <span>
                {recentlyEditedIds.size} of {expenseCount} expenses edited
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {uploadState === "review" ? "Done" : "Cancel"}
            </Button>
            {uploadState === "review" && (
              <Button
                onClick={() => {
                  // Reset for additional uploads
                  setUploads([]);
                  setSelectedExpense(null);
                }}
              >
                Upload More Files
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
