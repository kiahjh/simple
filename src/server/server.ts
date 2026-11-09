import dashboard from "../dashboard/index.html";
import { listSimulators, type Simulator } from "../simulators.ts";
import { VERSION } from "../version.ts";

export type SimulatorsResponse = { simulators: Simulator[] };

export type Health = {
  name: "simple";
  version: string;
  pid: number;
};

export function health(): Health {
  return { name: "simple", version: VERSION, pid: process.pid };
}

export function startServer(port: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Hot reloading and unminified bundles while working on the dashboard.
    development: process.env.SIMPLE_DEV === "1",
    routes: {
      "/": dashboard,
      "/api/health": () => Response.json(health()),
      "/api/simulators": async () => {
        try {
          const body: SimulatorsResponse = { simulators: await listSimulators() };
          return Response.json(body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });
}
