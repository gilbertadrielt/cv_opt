import type { Metadata } from "next";
import { InspectWorkspace } from "@/components/inspect/InspectWorkspace";

export const metadata: Metadata = {
  title: "Inspect — FA-Bench",
};

export default function InspectPage() {
  return <InspectWorkspace />;
}
