import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import path from "node:path";

// Two header-echo servers for the e2e harness: HTTP/1.1 in the clear and
// HTTP/2 over a throwaway self-signed cert. Every request is answered with an
// HTML page whose <pre id="echo"> holds the request headers as JSON, so a test
// page can read exactly what reached the wire after DNR ran.

function echoBody(headers) {
  const json = JSON.stringify(headers);
  return `<!doctype html><meta charset="utf-8"><title>echo</title><pre id="echo">${json}</pre>`;
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

function listen(server, host) {
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      resolve(server.address().port);
    });
  });
}

export async function startEchoServers({ host = "localhost" } = {}) {
  const h1 = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(echoBody(h1Headers(req)));
  });

  const h2 = createSecureServer({ ...selfSignedCert(), allowHTTP1: false });
  h2.on("stream", (stream, headers) => {
    stream.respond({
      ":status": 200,
      "content-type": "text/html; charset=utf-8",
    });
    stream.end(echoBody(h2Headers(headers)));
  });

  const [h1Port, h2Port] = await Promise.all([
    listen(h1, host),
    listen(h2, host),
  ]);

  return {
    h1Url: `http://${host}:${h1Port}`,
    h2Url: `https://${host}:${h2Port}`,
    async close() {
      await Promise.all([
        new Promise((resolve) => h1.close(resolve)),
        new Promise((resolve) => h2.close(resolve)),
      ]);
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const servers = await startEchoServers();
  process.stdout.write(
    `${JSON.stringify({ h1Url: servers.h1Url, h2Url: servers.h2Url })}\n`,
  );
  const shutdown = () => servers.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
