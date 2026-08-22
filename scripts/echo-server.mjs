import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import path from "node:path";
import { NARROW_H1_PORT } from "../e2e/echo-ports.mjs";

// Two header-echo servers for the e2e harness: HTTP/1.1 in the clear and
// HTTP/2 over a throwaway self-signed cert. Every request is answered with an
// HTML page whose <pre id="echo"> holds the request headers as JSON, so a test
// page can read exactly what reached the wire after DNR ran.

function echoBody(headers) {
  const json = JSON.stringify(headers);
  return `<!doctype html><meta charset="utf-8"><title>echo</title><pre id="echo">${json}</pre>`;
}

function jsonBody(headers, extra = {}) {
  return JSON.stringify({ headers, ...extra });
}

function responseHeaders(extra = {}) {
  return {
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "*",
    "cache-control": "no-store",
    ...extra,
  };
}

function h1Headers(req) {
  const headers = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers[req.rawHeaders[i].toLowerCase()] = req.rawHeaders[i + 1];
  }
  return headers;
}

function h2Headers(headers) {
  const echoed = {};
  for (const [name, value] of Object.entries(headers)) {
    echoed[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return echoed;
}

function selfSignedCert() {
  const dir = mkdtempSync(path.join(tmpdir(), "headershim-h2-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const material = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
  rmSync(dir, { recursive: true, force: true });
  return material;
}

function listen(server, host, port = 0) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve(server.address().port);
    });
  });
}

export async function startEchoServers({
  host = "localhost",
  h1Port = 0,
  h2Port = 0,
  listenHost,
} = {}) {
  const cacheRequests = new Map();
  const h1 = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, responseHeaders());
      res.end();
      return;
    }
    const headers = h1Headers(req);
    if (url.pathname === "/echo.json") {
      res.writeHead(
        200,
        responseHeaders({ "content-type": "application/json" }),
      );
      res.end(jsonBody(headers));
      return;
    }
    if (url.pathname === "/cache.json") {
      const key = url.searchParams.get("key") ?? "default";
      const requestCount = (cacheRequests.get(key) ?? 0) + 1;
      cacheRequests.set(key, requestCount);
      res.writeHead(
        200,
        responseHeaders({
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
          "x-headershim-cache": "server",
        }),
      );
      res.end(jsonBody(headers, { requestCount }));
      return;
    }
    if (url.pathname === "/cache-stats.json") {
      const key = url.searchParams.get("key") ?? "default";
      res.writeHead(
        200,
        responseHeaders({ "content-type": "application/json" }),
      );
      res.end(jsonBody(headers, { requestCount: cacheRequests.get(key) ?? 0 }));
      return;
    }
    res.writeHead(
      200,
      responseHeaders({ "content-type": "text/html; charset=utf-8" }),
    );
    res.end(echoBody(headers));
  });

  const h2 = createSecureServer({ ...selfSignedCert(), allowHTTP1: false });
  h2.on("stream", (stream, headers) => {
    const echoed = h2Headers(headers);
    const json = headers[":path"] === "/echo.json";
    stream.respond({
      ":status": 200,
      ...responseHeaders({
        "content-type": json ? "application/json" : "text/html; charset=utf-8",
      }),
    });
    stream.end(json ? jsonBody(echoed) : echoBody(echoed));
  });

  const [boundH1Port, boundH2Port] = await Promise.all([
    listen(h1, listenHost, h1Port),
    listen(h2, listenHost, h2Port),
  ]);

  const crossHost = host === "localhost" ? "127.0.0.1" : "localhost";

  return {
    h1CrossUrl: `http://${crossHost}:${boundH1Port}`,
    h1Url: `http://${host}:${boundH1Port}`,
    h2Url: `https://${host}:${boundH2Port}`,
    async close() {
      await Promise.all([
        new Promise((resolve) => h1.close(resolve)),
        new Promise((resolve) => h2.close(resolve)),
      ]);
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const literalPorts = process.env.HEADERSHIM_LITERAL_GRANT_PORTS === "1";
  const servers = await startEchoServers(
    literalPorts ? { h1Port: NARROW_H1_PORT } : {},
  );
  process.stdout.write(
    `${JSON.stringify({ h1CrossUrl: servers.h1CrossUrl, h1Url: servers.h1Url, h2Url: servers.h2Url })}\n`,
  );
  const shutdown = () => servers.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
