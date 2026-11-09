import { existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths.ts";

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
};

/** The device set that only simple manages: the agents' simulators. */
export function agentDeviceSetPath(): string {
  return join(dataDir(), "devices");
}

/** Lists simulators in both groups: the person's (Xcode's default set) and the agents'. */
export async function listSimulators(): Promise<Simulator[]> {
  const agentSet = agentDeviceSetPath();
  const [yours, agents] = await Promise.all([
    simctlList([]),
    existsSync(agentSet) ? simctlList(["--set", agentSet]) : null,
  ]);
  // Device types and runtimes are machine-wide, so the default set's lists cover both groups.
  return sortSimulators([
    ...parseSimctlList(yours, "you", yours),
    ...(agents ? parseSimctlList(agents, "agents", yours) : []),
  ]);
}

// `xcrun simctl list -j`, trimmed to the fields simple reads.
export type SimctlList = {
  devicetypes?: { identifier: string; name: string }[];
  runtimes?: { identifier: string; name: string }[];
  devices: Record<
    string,
    {
      udid: string;
      name: string;
      state: string;
      isAvailable?: boolean;
      deviceTypeIdentifier?: string;
    }[]
  >;
};

export function parseSimctlList(list: SimctlList, group: Group, catalog: SimctlList): Simulator[] {
  const models = new Map(catalog.devicetypes?.map((t) => [t.identifier, t.name]));
  const oses = new Map(catalog.runtimes?.map((r) => [r.identifier, r.name]));
  return Object.entries(list.devices).flatMap(([runtime, devices]) =>
    devices.map((device) => ({
      udid: device.udid,
      name: device.name,
      model:
        models.get(device.deviceTypeIdentifier ?? "") ??
        nameFromIdentifier(device.deviceTypeIdentifier ?? "unknown"),
      os: oses.get(runtime) ?? osFromRuntime(runtime),
      state: stateFromSimctl(device.state),
      group,
      available: device.isAvailable ?? true,
    })),
  );
}

/** Running first, then starting and stopping, then off; alphabetical within each. */
export function sortSimulators(simulators: Simulator[]): Simulator[] {
  const order: Record<State, number> = { running: 0, starting: 1, stopping: 2, off: 3 };
  return [...simulators].sort(
    (a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name),
  );
}

function stateFromSimctl(state: string): State {
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

async function simctlList(setArgs: string[]): Promise<SimctlList> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["xcrun", "simctl", ...setArgs, "list", "-j"], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error("Couldn't run xcrun simctl. Is Xcode installed?");
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Couldn't list simulators (xcrun simctl exited ${code}): ${stderr.trim()}`);
  }
  return JSON.parse(stdout) as SimctlList;
}
