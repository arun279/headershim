import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { crxUrl, updateHost, updatePort } from "./constants.mjs";
import { crxPath, idPath } from "./pack.mjs";

// Serves the Omaha update manifest and the signed CRX that Chrome's
// force-install policy fetches at startup. Kept deliberately generic so the
// store-approximation rerun can reuse it unchanged.

function updateManifest(extensionId, version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="${crxUrl}" version="${version}" />
  </app>
</gupdate>
`;
}

export function startUpdateServer({ port = updatePort } = {}) {
  const crx = readFileSync(crxPath);
  const extensionId = readFileSync(idPath, "utf8").trim();
  const version = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ).version;

  const server = createServer((req, res) => {
    // Chrome's Omaha updater appends a query string (?x=id%3D…) to the update
    // URL, so match on the path alone or the update check 404s and the CRX is
    // never fetched.
    const { pathname } = new URL(req.url, `http://${updateHost}:${port}`);
    if (pathname === "/updates.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(updateManifest(extensionId, version));
      return;
    }
    if (pathname === "/headershim.crx") {
      res.writeHead(200, {
        "content-type": "application/x-chrome-extension",
        "content-length": crx.length,
      });
      res.end(crx);
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(port, updateHost, () => {
      const actualPort = server.address().port;
      resolve({
        url: `http://${updateHost}:${actualPort}`,
        extensionId,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startUpdateServer();
  process.stdout.write(
    `update server for ${server.extensionId} on ${server.url}\n`,
  );
  const shutdown = () => server.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
