import type { Metadata } from "next";
import { TopRail } from "@/components/layout/TopRail";
import { AppProviders } from "@/state/AppProviders";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "FA-Bench — Returns inspection",
  description:
    "Physical defect inspection console for returned AMD packages and boards: run a visual inspection, review findings, and build the disposition report.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full font-sans antialiased`}
    >
      {/* Full-height, non-scrolling shell: each region below manages its own
          overflow so the stage and the side columns scroll independently. */}
      <body className="flex h-full flex-col">
        <AppProviders>
          <TopRail />
          {/* `min-h-0` lets the workspace own its own scrolling rather than
              stretching the page — the stage and the findings list scroll
              independently. */}
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
