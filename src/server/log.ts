/** Writes a timestamped line to the server's log (stdout, which the background server sends to server.log). */
export function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}
