import { describe, expect, test } from "bun:test";
import { formatStatus } from "../src/cli/status.ts";
import { parseSimctlList, type SimctlList, sortSimulators } from "../src/simulators.ts";

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
    { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-1", name: "iOS 27.1" },
    { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", name: "iOS 27.0" },
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

const yours = sortSimulators(parseSimctlList(catalog, "you", catalog));

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

  test("--all lists everything and marks unavailable simulators", () => {
    const agents = parseSimctlList(
      { devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [samples] } },
      "agents",
      catalog,
    );
    const out = formatStatus([...yours, ...agents], {
      all: true,
      color: false,
      dashboard: "http://localhost:4729",
    });
    expect(out).toContain("○ Old Phone");
    expect(out).toContain("unavailable (runtime not installed)");
    expect(out).not.toContain("off (simple --all");
    expect(out).toContain("Agents\n  ● Samples");
    expect(out.endsWith("Dashboard: http://localhost:4729")).toBe(true);
  });
});
