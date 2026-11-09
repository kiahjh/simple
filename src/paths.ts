import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4729;

/** Where simple keeps its data. `SIMPLE_HOME` overrides it (used by tests). */
export function dataDir(): string {
  return process.env.SIMPLE_HOME ?? join(homedir(), "Library", "Application Support", "simple");
}

export function serverLogPath(): string {
  return join(dataDir(), "server.log");
}

/** The background server's port. `SIMPLE_PORT` overrides the default. */
export function serverPort(): number {
  const raw = process.env.SIMPLE_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SIMPLE_PORT must be a port number, got "${raw}"`);
  }
  return port;
}

export function dashboardUrl(port: number): string {
  return `http://localhost:${port}`;
}
