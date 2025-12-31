import { getIngestionPrompt } from "@/app/actions/ingestion";
import { IngestionPage } from "@/components/ingestion-page";

export default async function IngestionPromptPage() {
  const result = await getIngestionPrompt();

  return <IngestionPage initialPrompt={result.prompt} />;
}
