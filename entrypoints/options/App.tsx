import type { ComponentType, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { CURRENT } from "../../src/core/schema";
import { isRegexSupported } from "../../src/platform/dnr";
import { LiveRegionProvider } from "../../src/ui/a11y/LiveRegion";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { PauseBanner } from "../../src/ui/components/PauseBanner";
import { copy } from "../../src/ui/copy";
import { loadDeferred } from "../../src/ui/deferred";
import { createMutations } from "../../src/ui/state/mutations";
import { useAppState } from "../../src/ui/state/useAppState";
import { applyTheme } from "../../src/ui/theme";
import type { DeferredPageProps, DeferredSection } from "./DeferredPage";
import { RulesPage } from "./pages/Rules";
import { Wordmark } from "./Wordmark";
import "./App.css";

const mutations = createMutations({ validateRegex: isRegexSupported });
const VERSION = browser.runtime.getManifest().version;

type SectionId = "rules" | DeferredSection;

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
      { id: "rules", label: copy.options.nav.allRules },
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
  const [DeferredPage, setDeferredPage] =
    useState<ComponentType<DeferredPageProps>>();
  const [deferredFailed, setDeferredFailed] = useState(false);
  const previousSection = useRef(section);
  const theme = app.phase === "ready" ? app.doc.settings.theme : undefined;
  useEffect(() => {
    if (theme !== undefined) {
      applyTheme(theme);
    }
  }, [theme]);
  useEffect(() => {
    const changed = previousSection.current !== section;
    if (
      !changed ||
      app.phase !== "ready" ||
      (section !== "rules" && DeferredPage === undefined)
    ) {
      return;
    }
    previousSection.current = section;
    queueMicrotask(() => {
      document.getElementById(`${section}-title`)?.focus();
    });
  }, [section, app.phase, DeferredPage]);
  useEffect(() => {
    if (section !== "rules" && DeferredPage === undefined) {
      setDeferredFailed(false);
      void loadDeferred(() => import("./DeferredPage")).then(
        (module) => setDeferredPage(() => module.DeferredPage),
        () => setDeferredFailed(true),
      );
    }
  }, [section, DeferredPage]);

  return (
    <LiveRegionProvider>
      <div class="wb">
        <div class="wb-nav">
          <div class="wb-brand">
            <Wordmark />
            <span class="wb-version mono">{copy.options.version(VERSION)}</span>
          </div>
          <SectionNav current={section} />
        </div>
        <main class="wb-main">
          {app.phase === "ready" && app.doc.settings.paused && <PauseBanner />}
          {app.phase === "initializing" ? (
            <div aria-busy="true" />
          ) : app.phase === "newer-store" ? (
            <div class="wb-page">
              <EmptyState
                message={copy.errors.newerStore(app.foundVersion, CURRENT)}
              />
            </div>
          ) : section === "rules" ? (
            <RulesPage
              doc={app.doc}
              projection={app.live}
              grants={app.grants}
              mutations={mutations}
            />
          ) : deferredFailed ? (
            <div class="wb-page">
              <EmptyState message={copy.errors.pageLoad} />
            </div>
          ) : DeferredPage === undefined ? (
            <div aria-busy="true" />
          ) : (
            <DeferredPage
              section={section}
              doc={app.doc}
              projection={app.live}
              grants={app.grants}
              mutations={mutations}
            />
          )}
        </main>
      </div>
    </LiveRegionProvider>
  );
}

function SectionNav({ current }: { current: SectionId }) {
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
    : "rules";
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
