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
import { FleetPage } from "./pages/Fleet";
import { ImportExportPage } from "./pages/ImportExport";
import { ProfilesPage } from "./pages/Profiles";
import { SettingsPage } from "./pages/Settings";
import { SiteAccessPage } from "./pages/SiteAccess";
import { TrafficPage } from "./pages/Traffic";
import { Wordmark } from "./Wordmark";
import "./App.css";

const mutations = createMutations({ validateRegex: isRegexSupported });
const VERSION = browser.runtime.getManifest().version;

type SectionId =
  | "fleet"
  | "profiles"
  | "site-access"
  | "traffic"
  | "import-export"
  | "settings"
  | "about";

interface NavSection {
  readonly id: SectionId;
  readonly label: string;
}
interface NavGroup {
  readonly label: string;
  readonly sections: readonly NavSection[];
}

const GROUPS: readonly NavGroup[] = [
  {
    label: copy.options.nav.groupRules,
    sections: [
      { id: "fleet", label: copy.options.nav.fleet },
      { id: "profiles", label: copy.options.nav.profiles },
    ],
  },
  {
    label: copy.options.nav.groupManage,
    sections: [
      { id: "site-access", label: copy.options.nav.siteAccess },
      { id: "traffic", label: copy.options.nav.traffic },
      { id: "import-export", label: copy.options.nav.importExport },
      { id: "settings", label: copy.options.nav.settings },
      { id: "about", label: copy.options.nav.about },
    ],
  },
];

const SECTIONS: readonly NavSection[] = GROUPS.flatMap(
  (group) => group.sections,
);

export function App() {
  const app = useAppState();
  const section = useHashRoute();
  const previousSection = useRef(section);
  const theme = app.phase === "ready" ? app.doc.settings.theme : undefined;
  useEffect(() => {
    if (theme !== undefined) {
      applyTheme(theme);
    }
  }, [theme]);
  useEffect(() => {
    const changed = previousSection.current !== section;
    previousSection.current = section;
    if (!changed || app.phase !== "ready") {
      return;
    }
    queueMicrotask(() => {
      document.getElementById(`${section}-title`)?.focus();
    });
  }, [section, app.phase]);

  return (
    <LiveRegionProvider>
      <div class="wb">
        <div class="wb-nav">
          <div class="wb-brand">
            <Wordmark />
            <span class="wb-version mono">{copy.options.version(VERSION)}</span>
          </div>
          <WorkbenchNav current={section} />
        </div>
        <main class="wb-main">
          {app.phase === "initializing" ? (
            <div aria-busy="true" />
          ) : app.phase === "newer-store" ? (
            <div class="wb-page">
              <EmptyState
                message={copy.errors.newerStore(app.foundVersion, CURRENT)}
              />
            </div>
          ) : section === "fleet" ? (
            <FleetPage
              doc={app.doc}
              grants={app.grants}
              mutations={mutations}
            />
          ) : section === "profiles" ? (
            <ProfilesPage doc={app.doc} mutations={mutations} />
          ) : section === "site-access" ? (
            <SiteAccessPage doc={app.doc} grants={app.grants} />
          ) : section === "traffic" ? (
            <TrafficPage doc={app.doc} grants={app.grants} />
          ) : section === "import-export" ? (
            <ImportExportPage doc={app.doc} mutations={mutations} />
          ) : section === "settings" ? (
            <SettingsPage doc={app.doc} mutations={mutations} />
          ) : (
            <AboutPage />
          )}
        </main>
      </div>
    </LiveRegionProvider>
  );
}

function WorkbenchNav({ current }: { current: SectionId }) {
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

  let index = -1;
  return (
    <nav
      class="wb-nav-groups"
      aria-label={copy.options.nav.label}
      onKeyDown={onKeyDown}
    >
      {GROUPS.map((group) => (
        <div key={group.label} class="wb-nav-group">
          <span class="wb-nav-grouplabel silk">{group.label}</span>
          {group.sections.map((entry) => {
            index += 1;
            const linkIndex = index;
            return (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                class="wb-nav-link"
                aria-current={entry.id === current ? "page" : undefined}
                tabIndex={linkIndex === roving ? 0 : -1}
                ref={(node) => {
                  links.current[linkIndex] = node;
                }}
                onFocus={() => setRoving(linkIndex)}
              >
                {entry.label}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function currentSection(): SectionId {
  const id = window.location.hash.replace(/^#/, "");
  return SECTIONS.some((entry) => entry.id === id)
    ? (id as SectionId)
    : "fleet";
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
