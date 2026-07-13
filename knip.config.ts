import type { KnipConfig } from "knip";

export default {
  entry: [
    "src/**/*.test.ts",
    "e2e/specs/**/*.spec.ts",
    "e2e/packed/**/*.spec.ts",
    "e2e/packed/{pack,update-server,policy,selfcheck}.mjs",
    "scripts/echo-server.mjs",
  ],
  // The h2 echo server shells out to the system openssl to mint a throwaway cert.
  ignoreBinaries: ["openssl"],
} satisfies KnipConfig;
