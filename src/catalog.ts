import type { SimctlDeviceType, SimctlList, SimctlRuntime } from "./simctl.ts";

export type Resolved = { deviceType: SimctlDeviceType; runtime: SimctlRuntime };

/** Short names for common requests. Each picks the newest matching model. */
const ALIASES: Record<string, { family: string; pattern: RegExp }> = {
  iphone: { family: "iPhone", pattern: /^iPhone \d+ Pro$/ },
  ipad: { family: "iPad", pattern: /^iPad Pro 13-inch/ },
  duo: { family: "iPhone", pattern: /^iPhone Duo$/ },
};

export const DEFAULT_MODEL = "iphone";

/**
 * Turns a request like "duo", "iPhone 18 Pro" or "ipad" (plus an optional OS version like "27.0") into an exact
 * device type and runtime: the newest matching model, on the newest installed iOS that supports it.
 */
export function resolveDevice(
  query: string = DEFAULT_MODEL,
  os: string | undefined,
  list: SimctlList,
): Resolved {
  const types = list.devicetypes ?? [];
  const runtimes = (list.runtimes ?? []).filter(
    (r) => r.isAvailable !== false && r.platform === "iOS",
  );
  const supports = (runtime: SimctlRuntime, type: SimctlDeviceType) =>
    runtime.supportedDeviceTypes?.some((t) => t.identifier === type.identifier) ?? false;

  const q = query.trim().toLowerCase();
  const alias = ALIASES[q];
  const exact = types.filter((t) => t.name.toLowerCase() === q);
  const candidates = alias
    ? types.filter((t) => t.productFamily === alias.family && alias.pattern.test(t.name))
    : exact.length > 0
      ? exact
      : types.filter((t) => t.name.toLowerCase().includes(q));

  const runnable = candidates.filter((t) => runtimes.some((r) => supports(r, t)));
  if (runnable.length === 0) {
    throw new Error(
      `No installed simulator model matches "${query}". Try duo, ipad, iphone, or a model name from ` +
        "`xcrun simctl list devicetypes`.",
    );
  }
  // The newest model first; between variants of the same model, the plainest name ("(M5)" before "(M5) (16GB)").
  const deviceType = [...runnable].sort(
    (a, b) =>
      (b.minRuntimeVersion ?? 0) - (a.minRuntimeVersion ?? 0) || a.name.length - b.name.length,
  )[0] as SimctlDeviceType;

  const compatible = runtimes.filter((r) => supports(r, deviceType));
  const matching = os
    ? compatible.filter((r) => r.version === os || r.version.startsWith(`${os}.`))
    : compatible;
  if (matching.length === 0) {
    const versions = compatible.map((r) => r.name).join(", ");
    throw new Error(
      `${deviceType.name} isn't available on iOS ${os}. Installed and supported: ${versions}.`,
    );
  }
  const runtime = [...matching].sort((a, b) =>
    compareVersions(b.version, a.version),
  )[0] as SimctlRuntime;
  return { deviceType, runtime };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
