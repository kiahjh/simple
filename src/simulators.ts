import { type Registry, readRegistry } from "./agents/registry.ts";
import { type SimctlList, simctlList } from "./simctl.ts";

export type Group = "you" | "agents";
export type State = "running" | "starting" | "stopping" | "off";

export type Simulator = {
  udid: string;
  name: string;
  /** Device model, e.g. "iPad Pro 13-inch (M5)". */
  model: string;
  /** Operating system, e.g. "iOS 27.1". */
  os: string;
  state: State;
  group: Group;
  /** False when its runtime isn't installed, so it can't boot. */
  available: boolean;
  /** For agent simulators someone holds: who, and since when (ISO date). */
  owner: { label: string; since: string } | null;
};

/** How long a claim lasts without any simple command from its owner. */
export const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

export function claimIsLive(lastSeenAt: string, now = Date.now()): boolean {
  return now - Date.parse(lastSeenAt) < CLAIM_TTL_MS;
}

/** Lists every simulator, in two groups: the ones simple created for agents, and everyone else's ("you"). */
export async function listSimulators(): Promise<Simulator[]> {
  return sortSimulators(parseSimctlList(await simctlList(), readRegistry()));
}

export function parseSimctlList(
  list: SimctlList,
  registry: Registry,
  now = Date.now(),
): Simulator[] {
  const models = new Map(list.devicetypes?.map((t) => [t.identifier, t.name]));
  const oses = new Map(list.runtimes?.map((r) => [r.identifier, r.name]));
  return Object.entries(list.devices).flatMap(([runtime, devices]) =>
    devices.map((device) => {
      const agent = registry.simulators[device.udid];
      const claim = agent?.claim && claimIsLive(agent.claim.lastSeenAt, now) ? agent.claim : null;
      return {
        udid: device.udid,
        name: device.name,
        model:
          models.get(device.deviceTypeIdentifier ?? "") ??
          nameFromIdentifier(device.deviceTypeIdentifier ?? "unknown"),
        os: oses.get(runtime) ?? osFromRuntime(runtime),
        state: stateFromSimctl(device.state),
        group: agent ? "agents" : "you",
        available: device.isAvailable ?? true,
        owner: claim ? { label: claim.label, since: claim.claimedAt } : null,
      } satisfies Simulator;
    }),
  );
}

/** Running first, then starting and stopping, then off; alphabetical within each. */
export function sortSimulators(simulators: Simulator[]): Simulator[] {
  const order: Record<State, number> = { running: 0, starting: 1, stopping: 2, off: 3 };
  return [...simulators].sort(
    (a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name),
  );
}

export function stateFromSimctl(state: string): State {
  switch (state) {
    case "Booted":
      return "running";
    case "Booting":
      return "starting";
    case "Shutting Down":
      return "stopping";
    default:
      return "off";
  }
}

/** "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "iOS 17.5", for runtimes that aren't installed. */
function osFromRuntime(identifier: string): string {
  const last = identifier.split(".").pop() ?? identifier;
  const [platform, ...version] = last.split("-");
  return version.length ? `${platform} ${version.join(".")}` : last;
}

/** "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro" → "iPhone 16 Pro". */
function nameFromIdentifier(identifier: string): string {
  return (identifier.split(".").pop() ?? identifier).replaceAll("-", " ");
}
