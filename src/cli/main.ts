#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { dashboardUrl, serverPort } from "../paths.ts";
import { runServer } from "../server/main.ts";
import { listSimulators } from "../simulators.ts";
import { VERSION } from "../version.ts";
import { ensureServer, fetchHealth, stopServer } from "./server-control.ts";
import { formatStatus } from "./status.ts";

const HELP = `simple: simulator tooling for people and agents

Usage:
  simple [status] [--all] [--json]   List simulators: yours, and the agents'
  simple dashboard [--open]          Start the background server if needed and print the dashboard URL
  simple server status               Show whether the background server is running
  simple server stop                 Stop the background server

Options:
  --all                              Include simulators that are off
  --json                             Print machine-readable JSON (always includes every simulator)
  -h, --help                         Show this help
  -v, --version                      Print the version
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
  switch (command) {
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
