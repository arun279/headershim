import type { BrowserContext, Page, Worker } from "@playwright/test";
import type { StateDoc } from "../../src/core/model";
import { copy as optionsCopy, siteAccessCopy } from "../../src/ui/copy.options";
import { seedStateAndWait } from "../fixtures";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const POPUP = { width: 398, height: 700 };
export const OPTIONS_WIDTHS = [360, 768, 1280] as const;

// A host the options page never reads (it has no active tab); the reaching rules
// still carry their pathological values into every rule list.
export const OPTIONS_HOST = "example.com";

export const OPTIONS_ROUTES = [
  { hash: "rules", title: optionsCopy.options.allRules.title },
  { hash: "profiles", title: optionsCopy.options.profiles.title },
  { hash: "site-access", title: siteAccessCopy.title },
  { hash: "traffic", title: optionsCopy.options.traffic.title },
  { hash: "import-export", title: optionsCopy.options.importExport.title },
  { hash: "settings", title: optionsCopy.options.settings.title },
  { hash: "about", title: optionsCopy.options.about.title },
] as const;

export function withTheme(doc: StateDoc, theme: Theme): StateDoc {
  return { ...doc, settings: { ...doc.settings, theme } };
}

export const popupUrl = (extensionId: string): string =>
  `chrome-extension://${extensionId}/popup.html`;

export async function openPopupOnHost({
  context,
  extensionId,
  foregroundPage,
  serviceWorker,
  doc,
  theme,
  reducedMotion = false,
}: {
  context: BrowserContext;
  extensionId: string;
  foregroundPage: Page;
  serviceWorker: Worker;
  doc: StateDoc;
  theme: Theme;
  reducedMotion?: boolean;
}): Promise<Page> {
  await seedStateAndWait(serviceWorker, withTheme(doc, theme));
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }
  await page.goto(popupUrl(extensionId));
  await foregroundPage.bringToFront();
  await page.reload();
  return page;
}
