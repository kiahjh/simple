import { resolveDevice } from "../catalog.ts";
import { serveSim } from "../server/helpers.ts";
import { type SimctlDevice, type SimctlList, simctl, simctlList } from "../simctl.ts";
import { claimIsLive, listSimulators, type Simulator } from "../simulators.ts";
import type { Owner } from "./owner.ts";
import { type AgentSimulator, type Registry, readRegistry, withRegistry } from "./registry.ts";

/** Agent simulators nobody has used for this long are deleted. */
export const CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A reset that hasn't finished after this long was interrupted; the simulator is usable again (and still dirty). */
const RESET_STALE_MS = 5 * 60 * 1000;

export type ClaimRequest = {
  model?: string;
  os?: string;
  owner: Owner;
  log?: (message: string) => void;
};

/**
 * Gives the owner a booted agent simulator of the requested model: the one it already holds, an idle one (erased
 * first if someone used it), or a new one. Returns once it's fully booted.
 */
export async function claim({
  model,
  os,
  owner,
  log = () => {},
}: ClaimRequest): Promise<Simulator> {
  const list = await simctlList();
  const { deviceType, runtime } = resolveDevice(model, os, list);
  const devices = devicesByUdid(list);
  const matches = (udid: string) => {
    const d = devices.get(udid);
    return (
      d?.device.deviceTypeIdentifier === deviceType.identifier && d.runtime === runtime.identifier
    );
  };

  const now = new Date();
  const plan = await withRegistry(async (registry) => {
    const housekeeping = tidy(registry, devices, now);

    const mine = Object.entries(registry.simulators).find(
      ([udid, s]) =>
        s.claim?.owner === owner.id && claimIsLive(s.claim.lastSeenAt, +now) && matches(udid),
    );
    if (mine) {
      (mine[1].claim as NonNullable<AgentSimulator["claim"]>).lastSeenAt = now.toISOString();
      return { udid: mine[0], erase: false, ...housekeeping };
    }

    const idle = Object.entries(registry.simulators).find(
      ([udid, s]) => !s.claim && !isResetting(s, +now) && matches(udid),
    );
    const claimRecord = {
      owner: owner.id,
      label: owner.label,
      claimedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    };
    if (idle) {
      const [udid, s] = idle;
      const erase = s.dirty;
      Object.assign(s, {
        claim: claimRecord,
        dirty: true,
        lastUsedAt: now.toISOString(),
        resettingSince: undefined,
      });
      return { udid, erase, ...housekeeping };
    }

    const name = uniqueName(
      `Agent · ${deviceType.name}`,
      [...devices.values()].map((d) => d.device.name),
    );
    log(`Creating ${name} (${runtime.name})…`);
    const udid = (await simctl(["create", name, deviceType.identifier, runtime.identifier])).trim();
    registry.simulators[udid] = {
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      claim: claimRecord,
      dirty: true,
    };
    return { udid, erase: false, ...housekeeping };
  });

  if (plan.erase) {
    log("Erasing it first (someone used it before)…");
    await eraseSimulator(plan.udid);
  }
  log("Booting…");
  await boot(plan.udid);

  // Housekeeping for other simulators, after ours is ready.
  await Promise.all(plan.toReset.map((udid) => resetSimulator(udid)));
  await Promise.all(plan.toDelete.map((udid) => simctl(["delete", udid]).catch(() => {})));

  const simulator = (await listSimulators()).find((s) => s.udid === plan.udid);
  if (!simulator) throw new Error(`The claimed simulator (${plan.udid}) disappeared.`);
  return simulator;
}

/**
 * Releases the owner's simulators (or one of them): they're shut down and erased for the next agent.
 * Releasing someone else's simulator needs `force`.
 */
export async function release(owner: Owner, udid?: string, force = false): Promise<string[]> {
  const now = new Date().toISOString();
  const released = await withRegistry((registry) => {
    const entries = Object.entries(registry.simulators).filter(([id, s]) =>
      udid ? id === udid : s.claim?.owner === owner.id,
    );
    if (udid && entries.length === 0)
      throw new Error(`${udid} isn't one of simple's agent simulators.`);
    for (const [id, s] of entries) {
      if (s.claim && s.claim.owner !== owner.id && !force) {
        throw new Error(`${id} is held by ${s.claim.label}. Use --force to release it anyway.`);
      }
    }
    return entries.map(([id, s]) => {
      Object.assign(s, { claim: null, lastUsedAt: now, resettingSince: now });
      return id;
    });
  });
  await Promise.all(released.map((id) => resetSimulator(id)));
  return released;
}

/** Marks the owner as active, so its claims don't lapse. Cheap when it holds nothing. */
export async function touch(owner: Owner): Promise<void> {
  const holds = (registry: Registry) =>
    Object.values(registry.simulators).some((s) => s.claim?.owner === owner.id);
  if (!holds(readRegistry())) return;
  const now = new Date().toISOString();
  await withRegistry((registry) => {
    for (const s of Object.values(registry.simulators)) {
      if (s.claim?.owner === owner.id && claimIsLive(s.claim.lastSeenAt)) s.claim.lastSeenAt = now;
    }
  });
}

/** Ends lapsed claims (resetting those simulators) and deletes long-unused ones. The server runs this regularly. */
export async function tidyUp(): Promise<void> {
  if (Object.keys(readRegistry().simulators).length === 0) return;
  const list = await simctlList();
  const plan = await withRegistry((registry) => tidy(registry, devicesByUdid(list), new Date()));
  await Promise.all(plan.toReset.map((udid) => resetSimulator(udid)));
  await Promise.all(plan.toDelete.map((udid) => simctl(["delete", udid]).catch(() => {})));
}

/** Registry housekeeping inside the lock; returns the slow simctl work to do after it. */
function tidy(
  registry: Registry,
  devices: Map<string, { device: SimctlDevice; runtime: string }>,
  now: Date,
): { toReset: string[]; toDelete: string[] } {
  const toReset: string[] = [];
  const toDelete: string[] = [];
  for (const [udid, s] of Object.entries(registry.simulators)) {
    if (!devices.has(udid)) {
      // Deleted outside simple.
      delete registry.simulators[udid];
    } else if (s.claim && !claimIsLive(s.claim.lastSeenAt, +now)) {
      Object.assign(s, {
        claim: null,
        lastUsedAt: now.toISOString(),
        resettingSince: now.toISOString(),
      });
      toReset.push(udid);
    } else if (
      !s.claim &&
      !isResetting(s, +now) &&
      +now - Date.parse(s.lastUsedAt) > CLEANUP_AFTER_MS
    ) {
      delete registry.simulators[udid];
      toDelete.push(udid);
    }
  }
  return { toReset, toDelete };
}

function isResetting(s: AgentSimulator, now: number): boolean {
  return s.resettingSince !== undefined && now - Date.parse(s.resettingSince) < RESET_STALE_MS;
}

/** Shuts a released simulator down and erases it, then marks it clean and available. */
async function resetSimulator(udid: string): Promise<void> {
  try {
    await eraseSimulator(udid);
  } finally {
    await withRegistry((registry) => {
      const s = registry.simulators[udid];
      if (s && !s.claim) {
        s.dirty = false;
        s.resettingSince = undefined;
      }
    });
  }
}

async function eraseSimulator(udid: string): Promise<void> {
  await simctl(["shutdown", udid]).catch(() => {}); // Fails harmlessly when it's already off.
  await simctl(["erase", udid]);
}

async function boot(udid: string): Promise<void> {
  await simctl(["boot", udid]).catch((error: Error) => {
    if (!/current state: Booted/.test(error.message)) throw error;
  });
  await simctl(["bootstatus", udid, "-b"], 300_000);
  await reclaimKeyboardInput(udid);
}

/**
 * Xcode 27's Device Hub takes over keyboard input for the simulators it knows about, even ones it isn't showing,
 * so typing through serve-sim does nothing (touches still work). serve-sim's `repair-input` takes it back by
 * restarting the simulator's home screen, which closes its apps. That's free right after booting, before the
 * agent has opened anything.
 */
async function reclaimKeyboardInput(udid: string): Promise<void> {
  if (!(await deviceHubHasKeyboard(udid))) return;
  await serveSim(["repair-input", "-d", udid]).catch(() => {});
  // Wait for the home screen to come back.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const services = await simctl(["spawn", udid, "launchctl", "list"]).catch(() => "");
    if (/^\d+\s+\S+\s+com\.apple\.SpringBoard$/m.test(services)) break;
    await Bun.sleep(500);
  }
  await Bun.sleep(2000);
}

/** Whether Device Hub has taken over the simulator's keyboard input. */
export async function deviceHubHasKeyboard(udid: string): Promise<boolean> {
  const out = await simctl([
    "spawn",
    udid,
    "notifyutil",
    "-g",
    "com.apple.coredevice.dtuhidd.active",
  ]).catch(() => "");
  return /\s1\s*$/.test(out);
}

function devicesByUdid(list: SimctlList): Map<string, { device: SimctlDevice; runtime: string }> {
  const out = new Map<string, { device: SimctlDevice; runtime: string }>();
  for (const [runtime, devices] of Object.entries(list.devices)) {
    for (const device of devices) out.set(device.udid, { device, runtime });
  }
  return out;
}

/** "Agent · iPhone 18 Pro", or "Agent · iPhone 18 Pro 2" if that's taken. */
export function uniqueName(base: string, taken: string[]): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}
