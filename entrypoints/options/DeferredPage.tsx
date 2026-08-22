import type { Projection } from "../../src/core/applied";
import type { GrantSnapshot } from "../../src/core/grants";
import type { StateDoc } from "../../src/core/model";
import type { Mutations } from "../../src/ui/state/mutations";
import { AboutPage } from "./pages/About";
import { ImportExportPage } from "./pages/ImportExport";
import { ProfilesPage } from "./pages/Profiles";
import { SettingsPage } from "./pages/Settings";
import { SiteAccessPage } from "./pages/SiteAccess";
import { TrafficPage } from "./pages/Traffic";

export type DeferredSection =
  | "profiles"
  | "site-access"
  | "traffic"
  | "import-export"
  | "settings"
  | "about";

export interface DeferredPageProps {
  readonly section: DeferredSection;
  readonly doc: StateDoc;
  readonly projection: Projection;
  readonly grants: GrantSnapshot;
  readonly mutations: Mutations;
}

export function DeferredPage({
  section,
  doc,
  projection,
  grants,
  mutations,
}: DeferredPageProps) {
  if (section === "profiles") {
    return (
      <ProfilesPage
        doc={doc}
        paused={doc.settings.paused}
        mutations={mutations}
      />
    );
  }
  if (section === "site-access") {
    return <SiteAccessPage doc={doc} grants={grants} />;
  }
  if (section === "traffic") {
    return <TrafficPage projection={projection} />;
  }
  if (section === "import-export") {
    return <ImportExportPage doc={doc} mutations={mutations} />;
  }
  if (section === "settings") {
    return <SettingsPage doc={doc} grants={grants} mutations={mutations} />;
  }
  return <AboutPage />;
}
