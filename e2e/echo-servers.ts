import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const echoServerScript = path.join(root, "scripts", "echo-server.mjs");

export interface EchoServers {
  h1CrossUrl: string;
  h1Url: string;
  h2Url: string;
}

export async function spawnEchoServers(): Promise<{
  servers: EchoServers;
  child: ChildProcess;
}> {
  const child = spawn(process.execPath, [echoServerScript], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const servers = await new Promise<EchoServers>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        child.stdout?.off("data", onData);
        resolve(JSON.parse(buffer.slice(0, newline)) as EchoServers);
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`echo server exited before ready (code ${code})`)),
    );
  });
  return { servers, child };
}

export function stopEchoServers(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
