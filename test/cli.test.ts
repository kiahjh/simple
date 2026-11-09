import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const home = mkdtempSync(join(tmpdir(), "simple-test-"));
const port = 47000 + Math.floor(Math.random() * 1000);
const env = { ...process.env, SIMPLE_HOME: home, SIMPLE_PORT: String(port) };
const base = `http://127.0.0.1:${port}`;
// Tests that list real simulators. The simulator service can take a while to answer on a cold machine.
const SIMCTL_TIMEOUT_MS = 60_000;

function simple(...args: string[]) {
  return simpleWith({}, ...args);
}

function simpleWith(extraEnv: Record<string, string>, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, "src/cli/main.ts", ...args], {
    env: { ...env, ...extraEnv },
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

afterAll(() => {
  simple("server", "stop");
  rmSync(home, { recursive: true, force: true });
});

describe("cli", () => {
  test("--version prints the package version", () => {
    expect(simple("--version")).toMatchObject({ code: 0, stdout: pkg.version });
  });

  test("--help prints usage", () => {
    expect(simple("--help")).toMatchObject({ code: 0 });
    expect(simple("--help").stdout).toContain("Usage:");
  });

  test(
    "no arguments lists simulators",
    () => {
      const result = simple();
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("You\n");
      // SIMPLE_HOME is a fresh folder, so the agents have no simulators yet.
      expect(result.stdout).toContain("Agents\n  none yet");
      expect(simple("status").stdout).toBe(result.stdout);
    },
    SIMCTL_TIMEOUT_MS,
  );

  test(
    "--json includes every simulator",
    () => {
      const result = simple("--json");
      expect(result.code).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.dashboard).toBeNull();
      expect(Array.isArray(body.simulators)).toBe(true);
      for (const sim of body.simulators) {
        expect(sim).toMatchObject({
          group: "you",
          udid: expect.any(String),
          state: expect.any(String),
        });
      }
    },
    SIMCTL_TIMEOUT_MS,
  );

  test("unknown commands and options are usage errors", () => {
    expect(simple("nope")).toMatchObject({ code: 2 });
    expect(simple("--nope")).toMatchObject({ code: 2 });
  });
});

describe("background server", () => {
  test("dashboard starts the server and serves the page", async () => {
    expect(simple("server", "status").stdout).toBe("not running");

    const result = simple("dashboard");
    expect(result).toMatchObject({ code: 0, stdout: `http://localhost:${port}` });
    expect(simple("server", "status").stdout).toStartWith(`running: version ${pkg.version}`);

    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health).toMatchObject({ name: "simple", version: pkg.version });

    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<div id="root">');
    const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(script).toBeDefined();
    expect((await fetch(`${base}${script}`)).status).toBe(200);
  });

  test(
    "the server lists simulators",
    async () => {
      const res = await fetch(`${base}/api/simulators`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.simulators)).toBe(true);
    },
    SIMCTL_TIMEOUT_MS,
  );

  test(
    "opening an unknown simulator explains itself",
    async () => {
      const res = await fetch(`${base}/sim/not-a-simulator`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("There's no simulator with that ID.");
    },
    SIMCTL_TIMEOUT_MS,
  );

  test("dashboard reuses a running server", () => {
    const before = simple("server", "status").stdout;
    simple("dashboard");
    expect(simple("server", "status").stdout).toBe(before);
  });

  test("dashboard restarts a server that's running older code", async () => {
    simple("server", "stop");
    simpleWith({ SIMPLE_BUILD_ID: "older-code" }, "dashboard");
    const old = await (await fetch(`${base}/api/health`)).json();
    expect(old.build).toBe("older-code");

    const result = simple("dashboard");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Restarting the simple server");
    const fresh = await (await fetch(`${base}/api/health`)).json();
    expect(fresh.build).not.toBe("older-code");
    expect(fresh.pid).not.toBe(old.pid);
  });

  test("server stop stops it", async () => {
    expect(simple("server", "stop").stdout).toBe("stopped");
    expect(simple("server", "status").stdout).toBe("not running");
    expect(simple("server", "stop").stdout).toBe("not running");
  });
});
