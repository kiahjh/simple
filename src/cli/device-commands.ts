import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Owner } from "../agents/owner.ts";
import { readRegistry } from "../agents/registry.ts";
import { type Element, formatElements, nameOf } from "../device.ts";
import type { ScreenContents } from "../server/device-actions.ts";
import { claimIsLive, listSimulators, type Simulator } from "../simulators.ts";
import { ensureServer } from "./server-control.ts";

export type TargetOptions = {
  /** A UDID or exact name, from `--sim`. */
  sim?: string;
  /** Allow changing a simulator the caller doesn't hold. */
  force?: boolean;
};

/**
 * The simulator a command acts on: `--sim`, or else the one the caller holds. Changing a simulator the caller
 * doesn't hold (the person's, or another agent's) needs `--force`; looking at any simulator is fine.
 */
export async function target(
  owner: Owner,
  options: TargetOptions,
  changes: boolean,
): Promise<Simulator> {
  const simulators = await listSimulators();
  const registry = readRegistry();
  const heldByCaller = (s: Simulator) => {
    const claim = registry.simulators[s.udid]?.claim;
    return claim?.owner === owner.id && claimIsLive(claim.lastSeenAt);
  };

  let simulator: Simulator;
  if (options.sim) {
    const wanted = options.sim.toLowerCase();
    const matches = simulators.filter(
      (s) => s.udid.toLowerCase() === wanted || s.name.toLowerCase() === wanted,
    );
    if (matches.length === 0) throw new Error(`No simulator has the ID or name "${options.sim}".`);
    if (matches.length > 1)
      throw new Error(`Several simulators are named "${options.sim}"; use its ID.`);
    simulator = matches[0] as Simulator;
  } else {
    const mine = simulators.filter(heldByCaller);
    if (mine.length === 0) {
      throw new Error(
        "You don't hold a simulator. Run `simple claim` first, or pick one with --sim.",
      );
    }
    if (mine.length > 1) {
      const list = mine.map((s) => `  ${s.name} (${s.udid})`).join("\n");
      throw new Error(`You hold ${mine.length} simulators; pick one with --sim:\n${list}`);
    }
    simulator = mine[0] as Simulator;
  }

  if (changes && !heldByCaller(simulator) && !options.force) {
    const whose =
      simulator.group === "you" ? "the user's" : `held by ${simulator.owner?.label ?? "nobody"}`;
    throw new Error(
      `${simulator.name} isn't yours (it's ${whose}). Use --force to change it anyway.`,
    );
  }
  if (simulator.state !== "running") throw new Error(`${simulator.name} isn't running.`);
  return simulator;
}

/** Calls the background server (starting it if needed) and returns its answer, or throws its error message. */
async function api(port: number, path: string, body?: unknown): Promise<Response> {
  await ensureServer(port);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {}
    throw new Error(message);
  }
  return res;
}

export async function screenshot(
  port: number,
  simulator: Simulator,
  out?: string,
): Promise<string> {
  const png = new Uint8Array(
    await (await api(port, `/api/simulators/${simulator.udid}/screenshot`)).arrayBuffer(),
  );
  const file = out ? resolve(out) : defaultScreenshotPath(simulator);
  writeFileSync(file, png);
  return file;
}

export async function ui(port: number, simulator: Simulator, json: boolean): Promise<string> {
  const contents = (await (
    await api(port, `/api/simulators/${simulator.udid}/ui`)
  ).json()) as ScreenContents;
  return json
    ? JSON.stringify(contents, null, 2)
    : formatElements(contents.elements, contents.screen);
}

export async function tap(
  port: number,
  simulator: Simulator,
  request: { label?: string; index?: number; at?: { x: number; y: number } },
): Promise<string> {
  const res = (await (
    await api(port, `/api/simulators/${simulator.udid}/tap`, request)
  ).json()) as {
    point: { x: number; y: number };
    element?: Element;
  };
  const what = res.element ? `${res.element.role} "${nameOf(res.element)}"` : "the screen";
  return `Tapped ${what} at ${res.point.x},${res.point.y}.`;
}

export async function typeText(port: number, simulator: Simulator, text: string): Promise<string> {
  await api(port, `/api/simulators/${simulator.udid}/type`, { text });
  return `Typed ${text.length} character${text.length === 1 ? "" : "s"}.`;
}

export async function fold(port: number, simulator: Simulator, pose: string): Promise<string> {
  const { degrees } = (await (
    await api(port, `/api/simulators/${simulator.udid}/fold`, { pose })
  ).json()) as {
    degrees: number;
  };
  return `Folded ${simulator.name} to ${degrees}°.`;
}

/** "x,y" in points. */
export function parsePoint(text: string): { x: number; y: number } {
  const [x, y] = text.split(",").map((n) => Number(n.trim()));
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Expected a point like 120,340, not "${text}".`);
  }
  return { x, y };
}

function defaultScreenshotPath(simulator: Simulator): string {
  const dir = join(tmpdir(), "simple-screenshots");
  mkdirSync(dir, { recursive: true });
  const slug = simulator.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `${slug}-${stamp}.png`);
}
