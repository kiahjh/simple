import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.ts";

/** Who holds an agent simulator. */
export type Claim = {
  /** e.g. "opencode:ses_…", "named:ci", or "you". */
  owner: string;
  /** What people see, e.g. the agent's project folder. */
  label: string;
  claimedAt: string;
  /** Last time the owner ran any simple command. Claims lapse after a while without one. */
  lastSeenAt: string;
};

/** A simulator simple created for agents. */
export type AgentSimulator = {
  createdAt: string;
  lastUsedAt: string;
  claim: Claim | null;
  /** Used since it was last erased, so it's erased before anyone else gets it. */
  dirty: boolean;
  /** Set while it's being shut down and erased; it can't be claimed until that finishes. */
  resettingSince?: string;
};

export type Registry = { simulators: Record<string, AgentSimulator> };

const LOCK_STALE_MS = 60_000;
const LOCK_TIMEOUT_MS = 30_000;

function registryPath(): string {
  return join(dataDir(), "agents.json");
}

/** Reads the registry without locking: fine for display, not for changes. */
export function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), "utf8")) as Partial<Registry>;
    return { simulators: parsed.simulators ?? {} };
  } catch {
    return { simulators: {} };
  }
}

/** Reads, changes and saves the registry while holding a lock, so concurrent simple commands don't clash. */
export async function withRegistry<T>(change: (registry: Registry) => T | Promise<T>): Promise<T> {
  mkdirSync(dataDir(), { recursive: true });
  const release = await lock(`${registryPath()}.lock`);
  try {
    const registry = readRegistry();
    const result = await change(registry);
    const temp = `${registryPath()}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`);
    renameSync(temp, registryPath());
    return result;
  } finally {
    release();
  }
}

/** A lock as a directory: creating one is atomic. Locks left behind by a crashed process expire after a minute. */
async function lock(path: string): Promise<() => void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(path);
      return () => rmSync(path, { recursive: true, force: true });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS)
          rmSync(path, { recursive: true, force: true });
      } catch {
        // It disappeared in between; try again.
      }
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for another simple command (${path}).`);
      await Bun.sleep(50);
    }
  }
}
