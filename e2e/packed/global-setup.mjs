import { existsSync } from "node:fs";
import { crxPath } from "./pack.mjs";
import { startUpdateServer } from "./update-server.mjs";

// Serves the packed CRX to Chrome's force-install policy for the run's
// lifetime. Packing and policy install are separate steps (the latter needs
// root), so this only asserts the CRX is present and returns a teardown.
export default async function globalSetup() {
  if (!existsSync(crxPath)) {
    throw new Error(
      'Packed CRX not found; run "pnpm e2e:packed:pack" before the packed specs.',
    );
  }
  const server = await startUpdateServer();
  return () => server.close();
}
