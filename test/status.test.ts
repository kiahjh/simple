import { describe, expect, test } from "bun:test";
import type { Registry } from "../src/agents/registry.ts";
import { formatStatus } from "../src/cli/status.ts";
import type { SimctlList } from "../src/simctl.ts";
import { parseSimctlList, sortSimulators } from "../src/simulators.ts";

const samples = {
  udid: "A",
  name: "Samples",
  state: "Booted",
  isAvailable: true,
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
};

const catalog: SimctlList = {
  devicetypes: [
    { identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo", name: "iPhone Duo" },
    {
      identifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB",
      name: "iPad Pro 13-inch (M5)",
    },
  ],
  runtimes: [
    {
      identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-1",
      name: "iOS 27.1",
      version: "27.1",
    },
    {
      identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
      name: "iOS 27.0",
      version: "27.0",
    },
  ],
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [
      samples,
      {
        udid: "B",
        name: "Another Duo",
        state: "Shutdown",
        isAvailable: true,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
      },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
      {
        udid: "C",
        name: "Big iPad",
        state: "Booting",
        isAvailable: true,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB",
      },
    ],
    // A runtime that isn't installed anymore.
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      {
        udid: "D",
        name: "Old Phone",
        state: "Shutdown",
        isAvailable: false,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-15",
      },
    ],
  },
};

const noAgents: Registry = { simulators: {} };
const yours = sortSimulators(parseSimctlList(catalog, noAgents));

describe("parseSimctlList", () => {
  test("names models and operating systems, and maps states", () => {
    expect(yours.find((s) => s.udid === "A")).toEqual({
      udid: "A",
      name: "Samples",
      model: "iPhone Duo",
      os: "iOS 27.1",
      state: "running",
      group: "you",
      available: true,
      owner: null,
    });
    expect(yours.find((s) => s.udid === "C")?.state).toBe("starting");
  });

  test("falls back to readable names when the runtime or model isn't installed", () => {
    expect(yours.find((s) => s.udid === "D")).toMatchObject({
      model: "iPhone 15",
      os: "iOS 17.5",
      available: false,
    });
  });

  test("sorts running, then starting, then off, alphabetically within each", () => {
    expect(yours.map((s) => s.udid)).toEqual(["A", "C", "B", "D"]);
  });
});

describe("formatStatus", () => {
  test("shows running simulators and counts the ones that are off", () => {
    const out = formatStatus(yours, { all: false, color: false, dashboard: null });
    expect(out).toBe(
      [
        "You",
        "  ● Samples    iPhone Duo              iOS 27.1   running",
        "  ◐ Big iPad   iPad Pro 13-inch (M5)   iOS 27.0   starting",
        "  + 2 off (simple --all to list them)",
        "",
        "Agents",
        "  none yet",
        "",
        "Dashboard: not running (simple dashboard --open)",
      ].join("\n"),
    );
  });

  test("with color, the model column is faint and italic", () => {
    const out = formatStatus(yours, { all: false, color: true, dashboard: null });
    expect(out).toContain("\x1b[2;3miPhone Duo           \x1b[0m");
  });

  test("--all lists everything and marks unavailable simulators", () => {
    const out = formatStatus(yours, {
      all: true,
      color: false,
      dashboard: "http://localhost:4729",
    });
    expect(out).toContain("○ Old Phone");
    expect(out).toContain("unavailable (runtime not installed)");
    expect(out).not.toContain("off (simple --all");
    expect(out.endsWith("Dashboard: http://localhost:4729")).toBe(true);
  });
});

describe("agent simulators", () => {
  const now = Date.parse("2026-11-09T20:00:00Z");
  const agentRecord = (claim: Registry["simulators"][string]["claim"]) => ({
    createdAt: "2026-11-09T18:00:00Z",
    lastUsedAt: "2026-11-09T18:00:00Z",
    claim,
    dirty: true,
  });

  test("are the ones in simple's registry, with their owners", () => {
    const registry: Registry = {
      simulators: {
        A: agentRecord({
          owner: "opencode:ses_1",
          label: "duo-support",
          claimedAt: "2026-11-09T19:14:00Z",
          lastSeenAt: "2026-11-09T19:50:00Z",
        }),
        B: agentRecord(null),
      },
    };
    const all = parseSimctlList(catalog, registry, now);
    expect(all.find((s) => s.udid === "A")).toMatchObject({
      group: "agents",
      owner: { label: "duo-support", since: "2026-11-09T19:14:00Z" },
    });
    expect(all.find((s) => s.udid === "B")).toMatchObject({ group: "agents", owner: null });
    expect(all.find((s) => s.udid === "C")?.group).toBe("you");

    const out = formatStatus(sortSimulators(all), {
      all: true,
      color: false,
      dashboard: null,
      formatTime: () => "2:14 PM",
    });
    expect(out).toContain(
      "Agents\n  ● Samples       iPhone Duo   iOS 27.1   running  held by duo-support since 2:14 PM",
    );
    expect(out).toContain("○ Another Duo   iPhone Duo   iOS 27.1   off      idle");
  });

  test("a claim lapses after 2 hours without a simple command from its owner", () => {
    const registry: Registry = {
      simulators: {
        A: agentRecord({
          owner: "opencode:ses_1",
          label: "duo-support",
          claimedAt: "2026-11-09T15:00:00Z",
          lastSeenAt: "2026-11-09T17:59:00Z",
        }),
      },
    };
    expect(parseSimctlList(catalog, registry, now).find((s) => s.udid === "A")?.owner).toBeNull();
  });
});
