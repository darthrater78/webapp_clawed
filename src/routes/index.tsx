import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import { ClawdmeterApp } from "@/components/clawd/ClawdmeterApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clawdmeter — 5-hour & weekly Claude usage" },
      {
        name: "description",
        content:
          "Track your rolling 5-hour session limit and weekly Claude quota with burn rate, projections and threshold alerts.",
      },
      { property: "og:title", content: "Clawdmeter — 5-hour & weekly Claude usage" },
      {
        property: "og:description",
        content:
          "A pixel-art usage meter for Claude: 5-hour session window, weekly quota, burn rate and runway — as a widget, side panel or full page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  // Everything runs in the browser: layout depends on the container size and
  // usage data comes from the configured Worker, with the local log as fallback.
  // No fallback wrapper: in widget hosts the card itself must be the root element.
  return (
    <ClientOnly fallback={null}>
      <ClawdmeterApp />
    </ClientOnly>
  );
}
