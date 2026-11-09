/** Running `xcrun simctl`, and the parts of its JSON output simple reads. */

export type SimctlDeviceType = {
  identifier: string;
  name: string;
  productFamily?: string;
  /** Oldest OS version the model supports, as a number (e.g. 27.0.0 → 1769472). */
  minRuntimeVersion?: number;
};

export type SimctlRuntime = {
  identifier: string;
  name: string;
  version: string;
  platform?: string;
  isAvailable?: boolean;
  supportedDeviceTypes?: { identifier: string }[];
};

export type SimctlDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
};

export type SimctlList = {
  devicetypes?: SimctlDeviceType[];
  runtimes?: SimctlRuntime[];
  /** Devices keyed by runtime identifier. */
  devices: Record<string, SimctlDevice[]>;
};

/** Runs `xcrun simctl <args>` and returns what it printed. */
export async function simctl(args: string[], timeoutMs = 120_000): Promise<string> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["xcrun", "simctl", ...args], { stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("Couldn't run xcrun simctl. Is Xcode installed?");
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(`xcrun simctl ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

export async function simctlList(): Promise<SimctlList> {
  return JSON.parse(await simctl(["list", "-j"])) as SimctlList;
}
