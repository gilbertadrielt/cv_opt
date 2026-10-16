import type { Metadata } from "next";
import { RunHistory } from "@/components/history/RunHistory";

export const metadata: Metadata = {
  title: "History — FA-Bench",
};

export default function HistoryPage() {
  return <RunHistory />;
}
