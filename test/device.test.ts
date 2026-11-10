import { describe, expect, test } from "bun:test";
import {
  type AxNode,
  elementsFrom,
  findElement,
  foldDegrees,
  formatElements,
  innerScreenShowing,
  isFoldable,
  screenFrom,
  toPanelCoordinates,
} from "../src/device.ts";
// Captured from an unfolded iPhone Duo (iOS 27.1) showing Gertrude Music's onboarding.
import duoAx from "./fixtures/duo-open-ax.json" with { type: "json" };
import duoConfig from "./fixtures/duo-open-config.json" with { type: "json" };

const tree = duoAx as AxNode[];

describe("screenFrom", () => {
  test("uses the interface orientation, though the tree reports the size portrait-first", () => {
    // The tree says 669×951, but the unfolded Duo's inner screen is used sideways.
    expect(screenFrom(tree, duoConfig)).toEqual({
      width: 951,
      height: 669,
      orientation: "landscape_left",
    });
    expect(screenFrom(tree, { width: 1, height: 1, orientation: "portrait" })).toEqual({
      width: 669,
      height: 951,
      orientation: "portrait",
    });
  });
});

describe("elementsFrom", () => {
  test("lists labeled elements in order, skipping the app itself", () => {
    const elements = elementsFrom(tree);
    expect(elements.map((e) => `${e.role}: ${e.label}`).slice(0, 3)).toEqual([
      expect.stringContaining("text: Are you the parent"),
      "button: Yes, I’m the parent or partner",
      "button: No, this device is mine",
    ]);
    expect(elements[1]?.center).toEqual({ x: 475.7, y: 528.5 });
  });
});

describe("findElement", () => {
  const elements = elementsFrom(tree);

  test("exact, then case-insensitive, then partial matches", () => {
    expect(findElement(elements, "No, this device is mine").label).toBe("No, this device is mine");
    expect(findElement(elements, "no, THIS device is mine").label).toBe("No, this device is mine");
    expect(findElement(elements, "parent or partner").label).toBe("Yes, I’m the parent or partner");
  });

  test("asks for --index when several match, and explains misses", () => {
    expect(() => findElement(elements, "device")).toThrow("pick one with --index");
    expect(findElement(elements, "device", 2).label).toBe("No, this device is mine");
    expect(() => findElement(elements, "Get started")).toThrow(
      'Nothing on screen is labeled "Get started"',
    );
  });
});

describe("toPanelCoordinates", () => {
  const sideways = screenFrom(tree, duoConfig);

  test("on the unfolded Duo, rotates into the panel's portrait frame", () => {
    // Measured: tapping "Get started" (center 475.7, 580.8) worked at raw 0.868, 0.500.
    const raw = toPanelCoordinates({ x: 475.7, y: 580.8 }, sideways);
    expect(raw.x).toBeCloseTo(0.868, 3);
    expect(raw.y).toBeCloseTo(0.5, 3);
  });

  test("portrait is unchanged", () => {
    const portrait = { width: 400, height: 800, orientation: "portrait" };
    expect(toPanelCoordinates({ x: 100, y: 200 }, portrait)).toEqual({ x: 0.25, y: 0.25 });
  });
});

test("formatElements is one line per element", () => {
  const out = formatElements(elementsFrom(tree), screenFrom(tree, duoConfig));
  expect(out.split("\n")[0]).toBe("Screen 951×669 points, landscape_left");
  expect(out).toContain('button       "No, this device is mine"  @ 475.7,588.8');
});

test("foldDegrees", () => {
  expect(foldDegrees("open")).toBe(180);
  expect(foldDegrees("Book")).toBe(130);
  expect(foldDegrees("90")).toBe(90);
  expect(() => foldDegrees("sideways")).toThrow("Expected open, book, closed");
});

test("which foldable screen is showing, with or without a reported hinge angle", () => {
  expect(isFoldable("iPhone Duo")).toBe(true);
  expect(isFoldable("iPhone 18 Pro")).toBe(false);
  expect(innerScreenShowing({ width: 1398, height: 2034, hingeDegrees: 180 })).toBe(true);
  expect(innerScreenShowing({ width: 2007, height: 2853, hingeDegrees: 0 })).toBe(false);
  // A fresh helper may leave the angle out: then the inner screen is the bigger one.
  expect(innerScreenShowing({ width: 1398, height: 2034 })).toBe(false);
  expect(innerScreenShowing({ width: 2007, height: 2853 })).toBe(true);
});

test("unlabeled fields are found and shown by their value", () => {
  const field = {
    role: "search text field",
    label: "",
    value: "Search",
    id: null,
    enabled: true,
    frame: { x: 0, y: 800, width: 400, height: 44 },
    center: { x: 200, y: 822 },
  };
  const row = {
    ...field,
    role: "button",
    label: "Search and Siri",
    value: null,
    center: { x: 200, y: 300 },
  };
  expect(findElement([row, field], "Search").role).toBe("search text field");
  expect(formatElements([field], { width: 402, height: 874, orientation: "portrait" })).toContain(
    'search text field "Search"  @ 200,822',
  );
});
