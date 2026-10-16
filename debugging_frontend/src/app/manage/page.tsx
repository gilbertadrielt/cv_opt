import type { Metadata } from "next";
import { ManageWorkspace } from "@/components/manage/ManageWorkspace";

export const metadata: Metadata = {
  title: "Manage — FA-Bench",
};

export default function ManagePage() {
  return <ManageWorkspace />;
}
