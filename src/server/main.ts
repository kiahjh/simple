import { serverPort } from "../paths.ts";
import { VERSION } from "../version.ts";
import { log } from "./log.ts";
import { startServer } from "./server.ts";

/** Runs the server in the foreground until it's told to stop. */
export function runServer(): void {
  const server = startServer(serverPort());
  log(`simple ${VERSION} listening on ${server.url} (pid ${process.pid})`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`stopping (${signal})`);
    await server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
