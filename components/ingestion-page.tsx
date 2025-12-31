"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveIngestionPrompt } from "@/app/actions/ingestion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function IngestionPage({ initialPrompt }: { initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveIngestionPrompt(prompt);
      if (result.error) {
        toast.error("Failed to save prompt", {
          description: result.error,
        });
        return;
      }
      toast.success("Prompt saved");
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Ingestion Prompt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Provide additional context for the ingestion agent. This stores your
            custom prompt for future ingestion runs.
          </p>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Add notes or preferences for how your statements should be parsed..."
            className="min-h-[180px]"
          />
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
