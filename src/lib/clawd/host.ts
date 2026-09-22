import {
  getUserInfo,
  getBrandingAssets,
  trackEvent,
  openSelfInNewTab,
  getAiAppPageUrl,
  type UserInfo,
  type BrandingAssets,
} from "ai-publish-sdk";

/**
 * All host-environment communication goes through ai-publish-sdk.
 * Every call is wrapped so the app keeps working when a capability is absent
 * (the SDK resolves null / rejects when no host is listening).
 */

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export type HostIdentity = {
  user: UserInfo | null;
  branding: BrandingAssets | null;
  pageUrl: string | null;
};

export async function loadHostIdentity(): Promise<HostIdentity> {
  const [user, branding, pageUrl] = await Promise.all([
    safe(() => getUserInfo()),
    safe(() => getBrandingAssets()),
    safe(() => getAiAppPageUrl()),
  ]);
  return { user, branding, pageUrl };
}

export function emit(
  eventName: string,
  additionalDetails?: Record<string, string | number | boolean | null>,
) {
  void safe(() =>
    trackEvent(additionalDetails ? { eventName, additionalDetails } : { eventName }),
  );
}

export function expandToTab() {
  void safe(() => openSelfInNewTab());
}
