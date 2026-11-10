#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { claim, release, touch } from "../agents/claims.ts";
import { currentOwner } from "../agents/owner.ts";
import { dashboardUrl, serverPort } from "../paths.ts";
import { runServer } from "../server/main.ts";
import { listSimulators } from "../simulators.ts";
import { VERSION } from "../version.ts";
import { fold, parsePoint, screenshot, tap, target, typeText, ui } from "./device-commands.ts";
import { ensureServer, fetchHealth, stopServer } from "./server-control.ts";
import { formatStatus } from "./status.ts";

const HELP = `simple: simulator tooling for people and agents

Usage:
  simple [status] [--all] [--json]   List simulators: yours, and the agents'
  simple claim [MODEL] [--os VERSION] [--json]
                                     Get a booted agent simulator and print its ID. MODEL is duo, ipad,
                                     iphone (the default), or a model name like "iPhone 18 Pro"
  simple release [ID] [--force]      Release your agent simulators (or one): they're shut down and erased

  simple screenshot [--out FILE]     Save an upright screenshot and print its path
  simple ui [--json]                 List what's on screen: buttons, text, fields, with their positions
  simple tap LABEL [--index N]       Tap something by its label (or part of it); --index picks among matches
  simple tap --at X,Y                Tap a point, in the screen's points (as shown by simple ui)
  simple type TEXT                   Type into whatever has focus
  simple fold open|book|closed|DEG   Fold an iPhone Duo

  These act on the simulator you hold (from simple claim), or the one named with --sim ID-OR-NAME.
  Changing a simulator you don't hold (tap, type, fold) needs --force.
  simple dashboard [--open]          Start the background server if needed and print the dashboard URL
  simple server status               Show whether the background server is running
  simple server stop                 Stop the background server

Options:
  --all                              Include simulators that are off
  --json                             Print machine-readable JSON (status always includes every simulator)
  --owner NAME                       Claim or release as NAME (default: this OpenCode session, or "you")
  -h, --help                         Show this help
  -v, --version                      Print the version

Claims last while their owner keeps using simple, and lapse after 2 hours without a simple command.
`;

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      open: { type: "boolean" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      os: { type: "string" },
      owner: { type: "string" },
      force: { type: "boolean" },
      sim: { type: "string" },
      out: { type: "string" },
      at: { type: "string" },
      index: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const [command = "status", ...rest] = positionals;
  const port = serverPort();
  const owner = currentOwner(values.owner);
  // Any simple command keeps the caller's claims alive.
  if (command !== "_server") await touch(owner);

  switch (command) {
    case "claim": {
      const progress = (message: string) => console.error(message);
      const simulator = await claim({ model: rest[0], os: values.os, owner, log: progress });
      console.log(values.json ? JSON.stringify(simulator, null, 2) : simulator.udid);
      return 0;
    }
    case "screenshot": {
      const simulator = await target(owner, values, false);
      console.log(await screenshot(port, simulator, values.out));
      return 0;
    }
    case "ui": {
      const simulator = await target(owner, values, false);
      console.log(await ui(port, simulator, Boolean(values.json)));
      return 0;
    }
    case "tap": {
      const label = rest.join(" ") || undefined;
      if (!label && !values.at)
        throw new UsageError("Say what to tap: simple tap LABEL, or simple tap --at X,Y.");
      const simulator = await target(owner, values, true);
      const index = values.index === undefined ? undefined : Number(values.index);
      const at = values.at ? parsePoint(values.at) : undefined;
      console.log(await tap(port, simulator, { label, index, at }));
      return 0;
    }
    case "type": {
      const text = rest.join(" ");
      if (!text) throw new UsageError("Say what to type: simple type TEXT.");
      const simulator = await target(owner, values, true);
      console.log(await typeText(port, simulator, text));
      return 0;
    }
    case "fold": {
      if (!rest[0]) throw new UsageError("Say how to fold: simple fold open|book|closed|DEGREES.");
      const simulator = await target(owner, values, true);
      console.log(await fold(port, simulator, rest[0]));
      return 0;
    }
    case "release": {
      const released = await release(owner, rest[0], Boolean(values.force));
      if (values.json) console.log(JSON.stringify({ released }, null, 2));
      else
        console.log(
          released.length ? `Released ${released.length} simulator(s).` : "Nothing to release.",
        );
      return 0;
    }
    case "status": {
      const [simulators, running] = await Promise.all([listSimulators(), fetchHealth(port)]);
      const dashboard = running ? dashboardUrl(port) : null;
      if (values.json) {
        console.log(JSON.stringify({ dashboard, simulators }, null, 2));
      } else {
        const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
        console.log(formatStatus(simulators, { all: Boolean(values.all), color, dashboard }));
      }
      return 0;
    }
    case "dashboard": {
      await ensureServer(port);
      const url = dashboardUrl(port);
      console.log(url);
      if (values.open) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      return 0;
    }
    case "server":
      return serverCommand(rest[0], port);
    case "_server":
      // Internal: the background server itself, started by ensureServer.
      runServer();
      return -1;
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

async function serverCommand(subcommand: string | undefined, port: number): Promise<number> {
  switch (subcommand) {
    case "status": {
      const running = await fetchHealth(port);
      console.log(
        running
          ? `running: version ${running.version}, pid ${running.pid}, ${dashboardUrl(port)}`
          : "not running",
      );
      return 0;
    }
    case "stop":
      console.log((await stopServer(port)) ? "stopped" : "not running");
      return 0;
    default:
      throw new UsageError(`Expected "simple server status" or "simple server stop".`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    // -1 means a long-running command (the server) is keeping the process alive.
    if (code >= 0) process.exit(code);
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`simple: ${message}`);
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`Run "simple --help" for usage.`);
      process.exit(2);
    }
    process.exit(1);
  },
);
