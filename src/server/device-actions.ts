import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceHubHasKeyboard } from "../agents/claims.ts";
import {
  type AxNode,
  type Element,
  elementsFrom,
  findElement,
  foldDegrees,
  innerScreenShowing,
  isFoldable,
  type Screen,
  type ScreenConfig,
  screenFrom,
  toPanelCoordinates,
} from "../device.ts";
import { simctl } from "../simctl.ts";
import type { Simulator } from "../simulators.ts";
import { type Helper, type Helpers, serveSim } from "./helpers.ts";

/** What `simple ui` shows. */
export type ScreenContents = { screen: Screen; elements: Element[] };

export type TapRequest = { label?: string; index?: number; at?: { x: number; y: number } };

/** Seeing and using a simulator through its serve-sim helper. */
export class DeviceActions {
  constructor(private readonly helpers: Helpers) {}

  async contents(simulator: Simulator): Promise<ScreenContents> {
    return this.withHelper(simulator, async (helper) => {
      const [tree, config] = await Promise.all([
        getJson<AxNode[]>(helper, "/ax"),
        screenConfig(helper),
      ]);
      return { screen: screenFrom(tree, config), elements: elementsFrom(tree) };
    });
  }

  /** An upright PNG of whichever screen is showing (the inner one on an unfolded Duo). */
  async screenshot(simulator: Simulator): Promise<Uint8Array<ArrayBuffer>> {
    return this.withHelper(simulator, async (helper) => {
      const config = await screenConfig(helper);
      // On the Duo, name the screen: simctl's default switches between the outer and inner screens.
      const display = isFoldable(simulator.model)
        ? [`--display=${innerScreenShowing(config) ? "primary-1" : "primary"}`]
        : [];
      const dir = mkdtempSync(join(tmpdir(), "simple-shot-"));
      try {
        const file = join(dir, "screen.png");
        await simctl(["io", simulator.udid, "screenshot", ...display, file]);
        return new Uint8Array(readFileSync(file));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  /** Taps an element by label, or a point (in points, current orientation). Returns what was tapped. */
  async tap(
    simulator: Simulator,
    request: TapRequest,
  ): Promise<{ point: { x: number; y: number }; element?: Element }> {
    if (isFoldable(simulator.model)) {
      const config = await this.withHelper(simulator, (helper) => screenConfig(helper));
      if (!innerScreenShowing(config)) {
        throw new Error(
          `Tapping ${simulator.name} while it's folded crashes the simulator's touch system (serve-sim can't ` +
            "tap the outer screen yet). Unfold it first: simple fold open.",
        );
      }
    }
    const { screen, elements } = await this.contents(simulator);
    const element =
      request.label !== undefined ? findElement(elements, request.label, request.index) : undefined;
    const point = element?.center ?? request.at;
    if (!point) throw new Error("Say what to tap: a label, or --at x,y.");
    const raw = toPanelCoordinates(point, screen);
    await serveSim(["tap", String(raw.x), String(raw.y), "--raw", "-d", simulator.udid]);
    return { point, element };
  }

  async type(simulator: Simulator, text: string): Promise<void> {
    if (await deviceHubHasKeyboard(simulator.udid)) {
      throw new Error(
        `Device Hub has taken over keyboard input on ${simulator.name}, so typing would do nothing. Agent ` +
          "simulators get it back when they're claimed: release this one and claim again.",
      );
    }
    await this.withHelper(simulator, () => serveSim(["type", "-d", simulator.udid, text]));
  }

  async fold(simulator: Simulator, pose: string): Promise<number> {
    const degrees = foldDegrees(pose);
    if (!isFoldable(simulator.model)) throw new Error(`${simulator.name} doesn't fold.`);
    await this.withHelper(simulator, () =>
      serveSim(["fold", String(degrees), "-d", simulator.udid]),
    );
    return degrees;
  }

  private async withHelper<T>(
    simulator: Simulator,
    use: (helper: Helper) => Promise<T>,
  ): Promise<T> {
    const helper = await this.helpers.acquire(simulator);
    try {
      return await use(helper);
    } finally {
      this.helpers.release(simulator.udid);
    }
  }
}

/** The screen's size and orientation. Helpers are only handed out once they know it (see Helpers). */
async function screenConfig(helper: Helper): Promise<ScreenConfig> {
  const config = await getJson<ScreenConfig>(helper, "/config");
  if (config.width === 0)
    throw new Error("serve-sim couldn't tell the screen's size. Is the simulator still starting?");
  return config;
}

async function getJson<T>(helper: Helper, path: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${helper.port}/helper/${helper.udid}${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new Error(
      `serve-sim's ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as T;
}
