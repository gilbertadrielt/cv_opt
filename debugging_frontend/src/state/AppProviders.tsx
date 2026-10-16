"use client";

import { FeedbackProvider } from "./FeedbackProvider";
import { InspectionProvider } from "./InspectionProvider";
import { KnowledgeBaseProvider } from "./KnowledgeBaseProvider";
import { ToastProvider } from "./ToastProvider";

/**
 * Session state shared across Inspect, History, and Manage.
 *
 * Mounted once in the root layout so runs and queued feedback survive
 * navigation between the three pages. Order matters: Inspection reads the
 * knowledge base to build its inference requests, and raises toasts.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <KnowledgeBaseProvider>
        <FeedbackProvider>
          <InspectionProvider>{children}</InspectionProvider>
        </FeedbackProvider>
      </KnowledgeBaseProvider>
    </ToastProvider>
  );
}
