import { serverPort } from "../paths.ts";
import { VERSION } from "../version.ts";
import { startServer } from "./server.ts";

/** Runs the server in the foreground until it's told to stop. */
export function runServer(): void {
  const server = startServer(serverPort());
  log(`simple ${VERSION} listening on ${server.url} (pid ${process.pid})`);

  const stop = (signal: string) => {
    log(`stopping (${signal})`);
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}
