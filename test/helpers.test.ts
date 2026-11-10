import { describe, expect, test } from "bun:test";
import { Helpers } from "../src/server/helpers.ts";
import type { Simulator } from "../src/simulators.ts";

function sim(udid: string, state: Simulator["state"] = "running"): Simulator {
  return {
    udid,
    name: udid,
    model: "iPhone",
    os: "iOS 27.0",
    state,
    group: "you",
    available: true,
    owner: null,
  };
}

/** A fake serve-sim CLI that records calls and how many starts overlap. */
function fakeServeSim() {
  const calls: string[][] = [];
  let running = 0;
  let maxOverlap = 0;
  let nextPort = 3100;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.includes("--list")) return JSON.stringify({ running: false });
    if (args.includes("--detach")) {
      running++;
      maxOverlap = Math.max(maxOverlap, running);
      await Bun.sleep(30);
      running--;
      return JSON.stringify({ port: nextPort++ });
    }
    return "{}";
  };
  return { run, calls, maxOverlap: () => maxOverlap };
}

describe("Helpers", () => {
  test("starts helpers one at a time, so they don't race for a port", async () => {
    const fake = fakeServeSim();
    const helpers = new Helpers({ runServeSim: fake.run, waitUntilReady: async () => {} });
    const [a, b] = await Promise.all([helpers.acquire(sim("A")), helpers.acquire(sim("B"))]);
    expect(fake.maxOverlap()).toBe(1);
    expect(new Set([a.port, b.port]).size).toBe(2);
  });

  test("starts one helper per simulator, however many viewers ask at once", async () => {
    const fake = fakeServeSim();
    const helpers = new Helpers({ runServeSim: fake.run, waitUntilReady: async () => {} });
    await Promise.all([
      helpers.acquire(sim("A")),
      helpers.acquire(sim("A")),
      helpers.acquire(sim("A")),
    ]);
    expect(fake.calls.filter((c) => c.includes("--detach"))).toHaveLength(1);
  });

  test("a failed start doesn't block later ones", async () => {
    const fake = fakeServeSim();
    let failNext = true;
    const helpers = new Helpers({
      waitUntilReady: async () => {},
      runServeSim: async (args) => {
        if (args.includes("--detach") && failNext) {
          failNext = false;
          throw new Error("Port 3100 is already in use");
        }
        return fake.run(args);
      },
    });
    await expect(helpers.acquire(sim("A"))).rejects.toThrow("already in use");
    expect((await helpers.acquire(sim("A"))).port).toBe(3100);
  });

  test("stops helpers whose simulators stopped running", async () => {
    const fake = fakeServeSim();
    const helpers = new Helpers({ runServeSim: fake.run, waitUntilReady: async () => {} });
    await helpers.acquire(sim("A"));
    await helpers.prune([sim("A", "off")]);
    expect(fake.calls.at(-1)).toEqual(["--kill", "A"]);
  });

  test("stops an idle helper, but not while serve-sim's full view is open on it", async () => {
    const fake = fakeServeSim();
    let fullViewOpen = true;
    const helpers = new Helpers({
      runServeSim: fake.run,
      hasInteractiveViewers: async () => fullViewOpen,
      waitUntilReady: async () => {},
      idleStopMs: 20,
    });
    await helpers.acquire(sim("A"));
    helpers.release("A");
    await Bun.sleep(70);
    expect(fake.calls.some((c) => c.includes("--kill"))).toBe(false);

    fullViewOpen = false;
    await Bun.sleep(50);
    expect(fake.calls.at(-1)).toEqual(["--kill", "A"]);
  });
});
