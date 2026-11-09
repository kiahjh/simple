import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { buildId } from "../build.ts";
import { dataDir, serverLogPath } from "../paths.ts";
import type { Health } from "../server/server.ts";

const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;
const POLL_MS = 100;

/** The running server's health, or null when nothing (or something else) answers on the port. */
export async function fetchHealth(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Health>;
    return body.name === "simple" ? (body as Health) : null;
  } catch {
    return null;
  }
}

/**
 * Returns the running server, starting one in the background first if needed. A server running different code
 * (for example from before an update) is restarted.
 */
export async function ensureServer(port: number): Promise<Health> {
  const running = await fetchHealth(port);
  if (running && running.build === buildId()) return running;
  if (running) {
    console.error("Restarting the simple server: it was running older code.");
    await stopServer(port);
  }

  mkdirSync(dataDir(), { recursive: true });
  const log = openSync(serverLogPath(), "a");
  const child = spawn(serverCommand()[0] as string, serverCommand().slice(1), {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, SIMPLE_PORT: String(port) },
  });
  child.unref();

  const started = await waitFor(() => fetchHealth(port), START_TIMEOUT_MS);
  if (!started) {
    throw new Error(
      `The server didn't start within ${START_TIMEOUT_MS / 1000}s. See ${serverLogPath()}`,
    );
  }
  return started;
}

/** Stops the running server. Returns false when none was running. */
export async function stopServer(port: number): Promise<boolean> {
  const running = await fetchHealth(port);
  if (!running) return false;

  process.kill(running.pid, "SIGTERM");
  const stopped = await waitFor(
    async () => ((await fetchHealth(port)) === null ? true : null),
    STOP_TIMEOUT_MS,
  );
  if (!stopped) throw new Error(`The server (pid ${running.pid}) didn't stop.`);
  return true;
}

/** How to launch this same program as the server, whether running from source or compiled. */
function serverCommand(): string[] {
  const compiled = Bun.main.startsWith("/$bunfs/");
  return compiled ? [process.execPath, "_server"] : [process.execPath, Bun.main, "_server"];
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== null) return result;
    await Bun.sleep(POLL_MS);
  }
  return null;
}
