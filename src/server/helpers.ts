import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentDeviceSetPath, type Simulator } from "../simulators.ts";
import { log } from "./log.ts";

/** How long a helper keeps running after its last viewer leaves. */
const IDLE_STOP_MS = 60_000;
/** serve-sim commands normally finish in about a second; anything far slower is stuck. */
const SERVE_SIM_TIMEOUT_MS = 20_000;

export type Helper = {
  udid: string;
  port: number;
  deviceSet: string | null;
  /** False when someone else started this helper; then simple never stops it. */
  ours: boolean;
  viewers: number;
  stopTimer?: ReturnType<typeof setTimeout>;
};

export type HelpersOptions = {
  /** Runs the serve-sim CLI. Tests pass a fake. */
  runServeSim?: (args: string[]) => Promise<string>;
  /** Whether someone has serve-sim's full interactive view open on this helper. */
  hasInteractiveViewers?: (helper: Helper) => Promise<boolean>;
  idleStopMs?: number;
};

/**
 * Runs serve-sim's streaming helpers: one per simulator that someone is watching, started on demand and stopped
 * a minute after the last viewer leaves (unless serve-sim's full view is still open on it) or as soon as the
 * simulator stops running.
 */
export class Helpers {
  private readonly helpers = new Map<string, Helper>();
  private readonly starting = new Map<string, Promise<Helper>>();
  /**
   * Helpers start one at a time: serve-sim picks each new helper's port itself, and two simultaneous starts
   * both pick the same one (one then fails with "Port 3100 is already in use", or hangs).
   */
  private startQueue: Promise<unknown> = Promise.resolve();

  private readonly runServeSim: (args: string[]) => Promise<string>;
  private readonly hasInteractiveViewers: (helper: Helper) => Promise<boolean>;
  private readonly idleStopMs: number;

  constructor(options: HelpersOptions = {}) {
    this.runServeSim = options.runServeSim ?? serveSim;
    this.hasInteractiveViewers = options.hasInteractiveViewers ?? interactiveViewers;
    this.idleStopMs = options.idleStopMs ?? IDLE_STOP_MS;
  }

  /** Returns a running helper for the simulator and counts a viewer until `release`. */
  async acquire(simulator: Simulator): Promise<Helper> {
    const helper = await this.ensure(simulator);
    helper.viewers++;
    clearTimeout(helper.stopTimer);
    helper.stopTimer = undefined;
    return helper;
  }

  release(udid: string): void {
    const helper = this.helpers.get(udid);
    if (!helper) return;
    helper.viewers = Math.max(0, helper.viewers - 1);
    if (helper.viewers === 0) this.scheduleIdleStop(helper);
  }

  /** Stops the helper after a quiet minute, checking again later while serve-sim's full view is open on it. */
  private scheduleIdleStop(helper: Helper): void {
    clearTimeout(helper.stopTimer);
    helper.stopTimer = setTimeout(async () => {
      if (this.helpers.get(helper.udid) !== helper || helper.viewers > 0) return;
      if (await this.hasInteractiveViewers(helper).catch(() => false)) {
        this.scheduleIdleStop(helper);
        return;
      }
      await this.stop(helper.udid);
    }, this.idleStopMs);
  }

  /** Forgets a helper that stopped answering, so the next viewer starts a fresh one. */
  forget(udid: string): void {
    const helper = this.helpers.get(udid);
    if (helper) clearTimeout(helper.stopTimer);
    this.helpers.delete(udid);
  }

  /** Stops helpers whose simulators aren't running anymore. */
  async prune(simulators: Simulator[]): Promise<void> {
    const running = new Set(simulators.filter((s) => s.state === "running").map((s) => s.udid));
    await Promise.all(
      [...this.helpers.keys()].filter((udid) => !running.has(udid)).map((udid) => this.stop(udid)),
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.helpers.keys()].map((udid) => this.stop(udid)));
  }

  private async ensure(simulator: Simulator): Promise<Helper> {
    const existing = this.helpers.get(simulator.udid);
    if (existing) return existing;
    let pending = this.starting.get(simulator.udid);
    if (!pending) {
      pending = this.startQueue
        .then(() => this.start(simulator))
        .finally(() => this.starting.delete(simulator.udid));
      this.startQueue = pending.catch(() => {});
      this.starting.set(simulator.udid, pending);
    }
    return pending;
  }

  private async start(simulator: Simulator): Promise<Helper> {
    const started = Date.now();
    try {
      const helper = await this.startHelper(simulator);
      log(
        `helper for ${simulator.name} (${simulator.udid}) on port ${helper.port}` +
          `${helper.ours ? "" : ", already running"}, ${Date.now() - started} ms`,
      );
      return helper;
    } catch (error) {
      log(`couldn't start a helper for ${simulator.name} (${simulator.udid}): ${String(error)}`);
      throw error;
    }
  }

  private async startHelper(simulator: Simulator): Promise<Helper> {
    const deviceSet = simulator.group === "agents" ? agentDeviceSetPath() : null;
    const setArgs = deviceSet ? ["--device-set", deviceSet] : [];
    const listed = parseJson(await this.runServeSim([...setArgs, "--list", simulator.udid]));
    const started = parseJson(
      await this.runServeSim([...setArgs, "--detach", "--quiet", simulator.udid]),
    );
    const port = Number(started.port);
    if (!Number.isInteger(port))
      throw new Error(`serve-sim didn't report a port for ${simulator.udid}`);
    const helper: Helper = {
      udid: simulator.udid,
      port,
      deviceSet,
      ours: listed.running !== true,
      viewers: 0,
    };
    this.helpers.set(simulator.udid, helper);
    return helper;
  }

  private async stop(udid: string): Promise<void> {
    const helper = this.helpers.get(udid);
    if (!helper) return;
    this.forget(udid);
    if (!helper.ours) return;
    const setArgs = helper.deviceSet ? ["--device-set", helper.deviceSet] : [];
    await this.runServeSim([...setArgs, "--kill", udid]).catch((error) =>
      log(`couldn't stop the helper for ${udid}: ${String(error)}`),
    );
    log(`stopped the helper for ${udid}`);
  }
}

export function helperStreamUrl(helper: Helper): string {
  return `http://127.0.0.1:${helper.port}/helper/${helper.udid}/stream.mjpeg`;
}

/** serve-sim's full interactive view of this helper's simulator. */
export function helperPageUrl(helper: Helper): string {
  return `http://127.0.0.1:${helper.port}/`;
}

/**
 * Whether serve-sim's full view is open on this helper. Its page holds a WebSocket for touch and keyboard input,
 * which serve-sim's diagnostics count; simple's thumbnails don't open one.
 */
async function interactiveViewers(helper: Helper): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${helper.port}/api/diagnostics`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { sessions?: { udid?: string; hid?: { sockets?: number } }[] };
  const session = body.sessions?.find((s) => s.udid === helper.udid);
  return (session?.hid?.sockets ?? 0) > 0;
}

// serve-sim's package exports don't include package.json, so TypeScript can't import it; Bun can still find it.
const SERVE_SIM_BIN = (() => {
  const packageJson = Bun.resolveSync("serve-sim/package.json", import.meta.dir);
  const { bin } = JSON.parse(readFileSync(packageJson, "utf8")) as { bin: Record<string, string> };
  return join(dirname(packageJson), bin["serve-sim"] ?? "dist/serve-sim.js");
})();

/** Runs the serve-sim CLI with Node (its supported runtime) and returns what it printed. */
async function serveSim(args: string[]): Promise<string> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["node", SERVE_SIM_BIN, ...args], { stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("Couldn't run serve-sim. Is Node.js 20 or later installed?");
  }
  const work = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Race rather than only killing: a child serve-sim starts could keep the output pipes open.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`serve-sim ${args.join(" ")} took over ${SERVE_SIM_TIMEOUT_MS / 1000}s`));
    }, SERVE_SIM_TIMEOUT_MS);
  });
  try {
    const [stdout, stderr, code] = await Promise.race([work, timeout]);
    if (code !== 0)
      throw new Error(`serve-sim ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

/** serve-sim prints one JSON object; take the last line that looks like one. */
function parseJson(output: string): Record<string, unknown> {
  const line = output
    .trim()
    .split("\n")
    .reverse()
    .find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error(`serve-sim printed no JSON: ${output.trim().slice(0, 200)}`);
  return JSON.parse(line) as Record<string, unknown>;
}
