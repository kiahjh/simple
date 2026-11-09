import { describe, expect, test } from "bun:test";
import { compareVersions, resolveDevice } from "../src/catalog.ts";
import type { SimctlList } from "../src/simctl.ts";
// Device types and runtimes from a real Mac with Xcode 27.1 beta (iOS 17.5, 18.2, 26.2, 26.5, 27.0, 27.1).
import catalog from "./fixtures/simctl-catalog.json" with { type: "json" };

const list = catalog as SimctlList;
const pick = (query?: string, os?: string) => {
  const { deviceType, runtime } = resolveDevice(query, os, list);
  return `${deviceType.name} / ${runtime.name}`;
};

describe("resolveDevice", () => {
  test("short names pick the newest matching model on the newest iOS that supports it", () => {
    expect(pick("iphone")).toBe("iPhone 18 Pro / iOS 27.0");
    expect(pick("ipad")).toBe("iPad Pro 13-inch (M5) / iOS 27.0");
    // iOS 27.1 is the only runtime with the Duo, and only has the Duo.
    expect(pick("duo")).toBe("iPhone Duo / iOS 27.1");
  });

  test("defaults to an iPhone", () => {
    expect(pick()).toBe("iPhone 18 Pro / iOS 27.0");
  });

  test("exact model names, in any case", () => {
    expect(pick("iPhone 15")).toBe("iPhone 15 / iOS 27.0");
    expect(pick("iphone 16 pro")).toBe("iPhone 16 Pro / iOS 27.0");
  });

  test("partial names pick the newest, plainest match", () => {
    expect(pick("pro max")).toBe("iPhone 18 Pro Max / iOS 27.0");
    expect(pick("ipad mini")).toContain("iPad mini");
  });

  test("an OS version picks that runtime, by prefix", () => {
    expect(pick("iPhone 15", "17.5")).toBe("iPhone 15 / iOS 17.5");
    expect(pick("iphone 16 pro", "18")).toBe("iPhone 16 Pro / iOS 18.2");
  });

  test("explains what's wrong", () => {
    expect(() => pick("nokia")).toThrow('No installed simulator model matches "nokia"');
    expect(() => pick("duo", "27.0")).toThrow("iPhone Duo isn't available on iOS 27.0");
    // Watch and TV models need runtimes that aren't installed.
    expect(() => pick("Apple TV")).toThrow("No installed simulator model");
  });
});

test("compareVersions compares numerically", () => {
  expect(compareVersions("27.0", "9.3")).toBeGreaterThan(0);
  expect(compareVersions("26.5", "26.10")).toBeLessThan(0);
  expect(compareVersions("27.0", "27.0.0")).toBe(0);
});
