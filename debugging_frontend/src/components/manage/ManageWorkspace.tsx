"use client";

import { useState } from "react";
import { useFeedback } from "@/state/FeedbackProvider";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { SubTabPanel, SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { FeedbackPanel } from "./FeedbackPanel";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";

type ManageTabId = "knowledge-base" | "feedback";

/**
 * The two ways the console gets better over time: correcting what a defect
 * *means* (the knowledge base) and correcting what the model *sees* (feedback).
 */
export function ManageWorkspace() {
  const [tab, setTab] = useState<ManageTabId>("knowledge-base");
  const { submissions } = useFeedback();

  const tabs: SubTab<ManageTabId>[] = [
    { id: "knowledge-base", label: "Defect knowledge base" },
    { id: "feedback", label: "Model feedback", count: submissions.length },
  ];

  return (
    <PageContainer>
      <PageHeader title="Manage">
        Keep the defect knowledge base current, and send corrected examples back to the model.
      </PageHeader>

      <SubTabs tabs={tabs} active={tab} onSelect={setTab} label="Manage sections" />

      {tab === "knowledge-base" ? (
        <SubTabPanel id="knowledge-base">
          <KnowledgeBasePanel />
        </SubTabPanel>
      ) : (
        <SubTabPanel id="feedback">
          <FeedbackPanel />
        </SubTabPanel>
      )}
    </PageContainer>
  );
}
