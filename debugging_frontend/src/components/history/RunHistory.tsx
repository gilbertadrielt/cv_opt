"use client";

import { useInspection } from "@/state/InspectionProvider";
import { PageContainer } from "@/components/layout/PageContainer";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { RunHistoryTable } from "./RunHistoryTable";

export function RunHistory() {
  const { runs } = useInspection();

  return (
    <PageContainer>
      <PageHeader title="Run history">
        Every inspection from this station, newest first. Open a run to see its annotated photos
        again or rebuild the report.
      </PageHeader>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs recorded yet"
          action={
            <ButtonLink href="/inspect" size="sm">
              Go to Inspect
            </ButtonLink>
          }
        >
          Inspections you run will be listed here with their findings.
        </EmptyState>
      ) : (
        <RunHistoryTable runs={runs} />
      )}
    </PageContainer>
  );
}
