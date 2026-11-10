import { tidyUp } from "../agents/claims.ts";
import { buildId } from "../build.ts";
import dashboard from "../dashboard/index.html";
import { MJPEG_CONTENT_TYPE, readMjpegFrames, throttledMjpeg } from "../mjpeg.ts";
import { listSimulators, type Simulator } from "../simulators.ts";
import { VERSION } from "../version.ts";
import { DeviceActions } from "./device-actions.ts";
import { type Helper, Helpers, helperPageUrl, helperStreamUrl } from "./helpers.ts";
import { log } from "./log.ts";

/** Thumbnails are small, so a few frames a second looks live without sending full-speed video. */
const THUMBNAIL_FPS = 5;
/** How long to wait for a helper to start answering a stream request. */
const CONNECT_TIMEOUT_MS = 5000;
const TIDY_INTERVAL_MS = 60_000;

export type Health = {
  name: "simple";
  version: string;
  /** Which code the server is running; see `buildId`. */
  build: string;
  pid: number;
};

export type SimulatorsResponse = { simulators: Simulator[] };

export function health(): Health {
  return { name: "simple", version: VERSION, build: buildId(), pid: process.pid };
}

export function startServer(port: number) {
  // Fingerprint the code now, at startup: later edits to the files shouldn't change what this server reports.
  buildId();
  const helpers = new Helpers();
  const device = new DeviceActions(helpers);

  /** Runs an action on a running simulator, turning problems into JSON errors. */
  const withRunning = async (udid: string, action: (s: Simulator) => Promise<Response>) => {
    try {
      const simulator = (await listSimulators()).find((s) => s.udid === udid);
      if (!simulator) return errorResponse(404, "There's no simulator with that ID.");
      if (simulator.state !== "running")
        return errorResponse(409, `${simulator.name} isn't running.`);
      return await action(simulator);
    } catch (error) {
      return errorResponse(500, error);
    }
  };
  // End lapsed claims and delete long-unused agent simulators, even when no agent runs simple for a while.
  const tidyTimer = setInterval(() => {
    tidyUp().catch((error) => log(`couldn't tidy agent simulators: ${String(error)}`));
  }, TIDY_INTERVAL_MS);

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
      // Seeing and using a simulator: `simple screenshot`, `ui`, `tap`, `type` and `fold` call these.
      "/api/simulators/:udid/screenshot": async (req) =>
        withRunning(req.params.udid, async (s) => {
          const png = await device.screenshot(s);
          return new Response(png, {
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
          });
        }),
      "/api/simulators/:udid/ui": async (req) =>
        withRunning(req.params.udid, async (s) => Response.json(await device.contents(s))),
      "/api/simulators/:udid/tap": {
        POST: async (req) =>
          withRunning(req.params.udid, async (s) =>
            Response.json(await device.tap(s, await req.json())),
          ),
      },
      "/api/simulators/:udid/type": {
        POST: async (req) =>
          withRunning(req.params.udid, async (s) => {
            const { text } = (await req.json()) as { text: string };
            await device.type(s, text);
            return Response.json({ typed: text.length });
          }),
      },
      "/api/simulators/:udid/fold": {
        POST: async (req) =>
          withRunning(req.params.udid, async (s) => {
            const { pose } = (await req.json()) as { pose: string };
            return Response.json({ degrees: await device.fold(s, pose) });
          }),
      },
      // Opens serve-sim's full interactive view: start the simulator's helper if needed, then send the browser to it.
      "/sim/:udid": async (req) => {
        const simulator = (await listSimulators()).find((s) => s.udid === req.params.udid);
        if (!simulator) return messagePage(404, "There's no simulator with that ID.");
        if (simulator.state !== "running") {
          return messagePage(409, `${simulator.name} isn't running.`);
        }
        try {
          const helper = await helpers.acquire(simulator);
          // Not a long-lived viewer: the full view keeps the helper alive through its own connection.
          helpers.release(simulator.udid);
          return Response.redirect(helperPageUrl(helper), 302);
        } catch (error) {
          return messagePage(502, `Couldn't open ${simulator.name}: ${String(error)}`);
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
      clearInterval(tidyTimer);
      await helpers.stopAll();
      server.stop(true);
    },
  };
}

/** A minimal page for errors people see in the browser rather than in the dashboard. */
function messagePage(status: number, message: string): Response {
  const escaped = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>simple</title>
<body style="font: 15px -apple-system, system-ui; padding: 48px; color-scheme: light dark">
<p>${escaped}</p><p><a href="/">Back to the dashboard</a></p>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function errorResponse(status: number, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}
