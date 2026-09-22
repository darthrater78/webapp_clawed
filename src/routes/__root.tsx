import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

/**
 * Status pages can render inside a widget host, so the root element is the card
 * itself (rounded 24px, clipped, filling its container), never a wrapper.
 */
function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ borderRadius: 24, overflow: "hidden" }}
      className="grid h-full w-full place-items-center bg-background p-4 text-center"
    >
      <div className="max-w-md">{children}</div>
    </div>
  );
}

const primaryAction =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

function NotFoundComponent() {
  return (
    <StatusCard>
      <h1 className="text-5xl font-bold text-foreground">404</h1>
      <p className="mt-2 text-sm text-muted-foreground">This page doesn&apos;t exist.</p>
      <Link to="/" className={`${primaryAction} mt-4`}>
        Go home
      </Link>
    </StatusCard>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  return (
    <StatusCard>
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        Clawdmeter didn&apos;t load
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again.</p>
      <button
        type="button"
        onClick={() => {
          void router.invalidate();
          reset();
        }}
        className={`${primaryAction} mt-4`}
      >
        Try again
      </button>
    </StatusCard>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Clawdmeter — Claude usage meter" },
      {
        name: "description",
        content: "Rolling 5-hour session and weekly Claude usage, with burn rate and projections.",
      },
      { property: "og:title", content: "Clawdmeter — Claude usage meter" },
      {
        property: "og:description",
        content: "Rolling 5-hour session and weekly Claude usage, with burn rate and projections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
