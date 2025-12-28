import { ElectricDebugPanel } from "@/components/electric-debug-panel";

export const metadata = {
  title: "Electric Debug",
  description: "Inspect ElectricSQL shape data.",
};

export default function ElectricDebugPage() {
  return (
    <div className="h-full w-full overflow-auto">
      <ElectricDebugPanel />
    </div>
  );
}
