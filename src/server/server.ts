import dashboard from "../dashboard/index.html";
import { MJPEG_CONTENT_TYPE, readMjpegFrames, throttledMjpeg } from "../mjpeg.ts";
import { listSimulators, type Simulator } from "../simulators.ts";
import { VERSION } from "../version.ts";
import { type Helper, Helpers, helperStreamUrl } from "./helpers.ts";
import { log } from "./log.ts";

/** Thumbnails are small, so a few frames a second looks live without sending full-speed video. */
const THUMBNAIL_FPS = 5;
/** How long to wait for a helper to start answering a stream request. */
const CONNECT_TIMEOUT_MS = 5000;

export type Health = {
  name: "simple";
  version: string;
  pid: number;
};

export type SimulatorsResponse = { simulators: Simulator[] };

export function health(): Health {
  return { name: "simple", version: VERSION, pid: process.pid };
}

export function startServer(port: number) {
  const helpers = new Helpers();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Hot reloading and unminified bundles while working on the dashboard.
    development: process.env.SIMPLE_DEV === "1",
    routes: {
      "/": dashboard,
      "/api/health": () => Response.json(health()),
      "/api/simulators": async () => {
        try {
          const simulators = await listSimulators();
          void helpers.prune(simulators);
          const body: SimulatorsResponse = { simulators };
          return Response.json(body);
        } catch (error) {
          return errorResponse(500, error);
        }
      },
      "/api/simulators/:udid/thumbnail": async (req, server) => {
        // Streams stay open for as long as someone's watching.
        server.timeout(req, 0);
        const simulator = (await listSimulators()).find((s) => s.udid === req.params.udid);
        if (!simulator) return errorResponse(404, "No simulator with that ID.");
        if (simulator.state !== "running")
          return errorResponse(409, "That simulator isn't running.");

        let helper: Helper;
        try {
          helper = await helpers.acquire(simulator);
        } catch (error) {
          return errorResponse(502, error);
        }
        const upstreamAbort = new AbortController();
        const connectTimer = setTimeout(() => upstreamAbort.abort(), CONNECT_TIMEOUT_MS);
        let upstream: Response;
        try {
          upstream = await fetch(helperStreamUrl(helper), { signal: upstreamAbort.signal });
          if (!upstream.ok || !upstream.body)
            throw new Error(`serve-sim answered ${upstream.status}`);
        } catch (error) {
          log(`couldn't stream ${simulator.name} (${simulator.udid}): ${String(error)}`);
          helpers.release(simulator.udid);
          helpers.forget(simulator.udid);
          return errorResponse(502, error);
        } finally {
          clearTimeout(connectTimer);
        }

        const body = throttledMjpeg(readMjpegFrames(upstream.body), THUMBNAIL_FPS, () => {
          upstreamAbort.abort();
          helpers.release(simulator.udid);
        });
        return new Response(body, {
          headers: { "Content-Type": MJPEG_CONTENT_TYPE, "Cache-Control": "no-store" },
        });
      },
    },
    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: server.url,
    async stop() {
      await helpers.stopAll();
      server.stop(true);
    },
  };
}

function errorResponse(status: number, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}
