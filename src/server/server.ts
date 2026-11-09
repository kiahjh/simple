import dashboard from "../dashboard/index.html";
import { VERSION } from "../version.ts";

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
    },
    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });
}
