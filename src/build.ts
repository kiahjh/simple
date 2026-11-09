import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "./version.ts";

const ROOT = join(import.meta.dir, "..");

let cached: string | undefined;

/**
 * Identifies the code that's running, so the CLI can tell when the background server is running older code and
 * restart it. Running from source, the version doesn't change between releases, so this also fingerprints the
 * source files. A compiled binary uses its version. `SIMPLE_BUILD_ID` overrides it (used by tests).
 */
export function buildId(): string {
  if (process.env.SIMPLE_BUILD_ID) return process.env.SIMPLE_BUILD_ID;
  if (cached) return cached;
  if (Bun.main.startsWith("/$bunfs/")) {
    cached = VERSION;
    return cached;
  }
  const hash = createHash("sha256");
  for (const file of [
    ...sourceFiles(join(ROOT, "src")),
    join(ROOT, "package.json"),
    join(ROOT, "bun.lock"),
  ]) {
    hash.update(file.slice(ROOT.length));
    hash.update(readFileSync(file));
  }
  cached = `${VERSION}+${hash.digest("hex").slice(0, 12)}`;
  return cached;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    })
    .sort();
}
