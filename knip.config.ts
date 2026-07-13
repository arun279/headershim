import type { KnipConfig } from "knip";

export default {
  entry: [
    "src/**/*.test.ts",
    "e2e/specs/**/*.spec.ts",
    "scripts/echo-server.mjs",
  ],
  // The h2 echo server shells out to the system openssl to mint a throwaway cert.
  ignoreBinaries: ["openssl"],
} satisfies KnipConfig;
