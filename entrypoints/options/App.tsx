import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { CURRENT } from "../../src/core/schema";
import { isRegexSupported } from "../../src/platform/dnr";
import { LiveRegionProvider } from "../../src/ui/a11y/LiveRegion";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { copy } from "../../src/ui/copy";
import { createMutations } from "../../src/ui/state/mutations";
import { useAppState } from "../../src/ui/state/useAppState";
import { applyTheme } from "../../src/ui/theme";
import { AboutPage } from "./pages/About";
import { ImportExportPage } from "./pages/ImportExport";
import { ProfilesPage } from "./pages/Profiles";
import { SiteAccessPage } from "./pages/SiteAccess";
import "./App.css";

const mutations = createMutations({ validateRegex: isRegexSupported });
const VERSION = browser.runtime.getManifest().version;

const SECTIONS = [
  { id: "profiles", label: copy.options.nav.profiles },
  { id: "site-access", label: copy.options.nav.siteAccess },
  { id: "import-export", label: copy.options.nav.importExport },
  { id: "settings", label: copy.options.nav.settings },
  { id: "about", label: copy.options.nav.about },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function App() {
  const app = useAppState();
  const section = useHashRoute();
  const [SettingsPage, setSettingsPage] =
    useState<typeof import("./pages/Settings").SettingsPage>();
  const theme = app.phase === "ready" ? app.doc.settings.theme : undefined;
  useEffect(() => {
    void import("./pages/Settings").then((module) =>
      setSettingsPage(() => module.SettingsPage),
    );
  }, []);
  useEffect(() => {
    if (theme !== undefined) {
      applyTheme(theme);
    }
  }, [theme]);
  useEffect(() => {
    if (app.phase !== "ready") {
      return;
    }
    queueMicrotask(() => {
      document.getElementById(`${section}-title`)?.focus();
    });
  }, [section, app.phase, SettingsPage]);

  return (
    <LiveRegionProvider>
      <div class="options">
        <header class="options-header">
          <span class="wordmark">{copy.app.name}</span>
          <span class="version mono">{copy.options.version(VERSION)}</span>
        </header>
        <div class="options-body">
          <OptionsNav current={section} />
          <main class="options-content">
            {app.phase === "initializing" ? (
              <div aria-busy="true" />
            ) : app.phase === "newer-store" ? (
              <EmptyState
                message={copy.errors.newerStore(app.foundVersion, CURRENT)}
              />
            ) : section === "profiles" ? (
              <ProfilesPage
                doc={app.doc}
                grants={app.grants}
                mutations={mutations}
              />
            ) : section === "site-access" ? (
              <SiteAccessPage doc={app.doc} grants={app.grants} />
            ) : section === "import-export" ? (
              <ImportExportPage doc={app.doc} mutations={mutations} />
            ) : section === "settings" ? (
              SettingsPage === undefined ? (
                <div aria-busy="true" />
              ) : (
                <SettingsPage doc={app.doc} mutations={mutations} />
              )
            ) : (
              <AboutPage />
            )}
          </main>
        </div>
      </div>
    </LiveRegionProvider>
  );
}

function OptionsNav({ current }: { current: SectionId }) {
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const currentIndex = Math.max(
    0,
    SECTIONS.findIndex((entry) => entry.id === current),
  );
  const [roving, setRoving] = useState(currentIndex);
  useEffect(() => setRoving(currentIndex), [currentIndex]);

  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(index, SECTIONS.length - 1));
    setRoving(target);
    links.current[target]?.focus();
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case "ArrowDown":
        moveTo(roving + 1);
        break;
      case "ArrowUp":
        moveTo(roving - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(SECTIONS.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <nav
      class="options-nav"
      aria-label={copy.options.nav.label}
      onKeyDown={onKeyDown}
    >
      {SECTIONS.map((entry, index) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          class="options-nav-link"
          aria-current={entry.id === current ? "page" : undefined}
          tabIndex={index === roving ? 0 : -1}
          ref={(node) => {
            links.current[index] = node;
          }}
          onFocus={() => setRoving(index)}
        >
          {entry.label}
        </a>
      ))}
    </nav>
  );
}

function currentSection(): SectionId {
  const id = window.location.hash.replace(/^#/, "");
  return SECTIONS.some((entry) => entry.id === id)
    ? (id as SectionId)
    : SECTIONS[0].id;
}

function useHashRoute(): SectionId {
  const [section, setSection] = useState<SectionId>(currentSection);
  useEffect(() => {
    const onChange = () => setSection(currentSection());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return section;
}
