/**
 * Reading what's on a simulator's screen and turning positions into taps. Pure functions over what serve-sim's
 * helper reports (`/ax` and `/config`), so they can be tested without a simulator.
 */

/** One node of serve-sim's accessibility tree (`/ax`). */
export type AxNode = {
  type?: string;
  role_description?: string;
  AXLabel?: string | null;
  AXValue?: string | null;
  AXUniqueId?: string | null;
  enabled?: boolean;
  frame?: { x: number; y: number; width: number; height: number };
  children?: AxNode[];
};

/** serve-sim's `/config`: the screen being streamed. */
export type ScreenConfig = {
  width: number;
  height: number;
  orientation?: string;
  /** Only on foldables: 0 is closed, 180 is fully open. */
  hingeDegrees?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type Element = {
  role: string;
  label: string;
  value: string | null;
  id: string | null;
  enabled: boolean;
  /** In points, in the screen's current orientation. */
  frame: Rect;
  center: { x: number; y: number };
};

export type Screen = {
  /** In points, in the screen's current orientation. */
  width: number;
  height: number;
  orientation: string;
};

/**
 * The screen's size in points, in its current orientation. The accessibility tree reports the app's size
 * portrait-first even when the interface is sideways (the unfolded iPhone Duo uses its inner screen in
 * landscape), while element positions follow the actual orientation.
 */
export function screenFrom(tree: AxNode[], config: ScreenConfig): Screen {
  const app = tree[0]?.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const orientation = config.orientation ?? "portrait";
  const long = Math.max(app.width, app.height);
  const short = Math.min(app.width, app.height);
  return orientation.startsWith("landscape")
    ? { width: long, height: short, orientation }
    : { width: short, height: long, orientation };
}

/** Everything on screen worth reading or tapping, in reading order. Unlabeled containers are skipped. */
export function elementsFrom(tree: AxNode[]): Element[] {
  const out: Element[] = [];
  const visit = (node: AxNode, isRoot: boolean) => {
    const label = (node.AXLabel ?? "").trim();
    const value = node.AXValue ?? null;
    const role = node.role_description || node.type || "element";
    if (!isRoot && node.frame && (label || value)) {
      const f = node.frame;
      out.push({
        role,
        label,
        value,
        id: node.AXUniqueId ?? null,
        enabled: node.enabled !== false,
        frame: { x: round(f.x), y: round(f.y), width: round(f.width), height: round(f.height) },
        center: { x: round(f.x + f.width / 2), y: round(f.y + f.height / 2) },
      });
    }
    for (const child of node.children ?? []) visit(child, false);
  };
  for (const root of tree) visit(root, true);
  return out;
}

/**
 * Finds the element to tap: an exact label match first, then a case-insensitive one, then one whose label
 * contains the text. `index` (1-based) picks among several matches.
 */
export function findElement(elements: Element[], label: string, index?: number): Element {
  const wanted = label.trim().toLowerCase();
  const tiers = [
    elements.filter((e) => nameOf(e) === label.trim()),
    elements.filter((e) => nameOf(e).toLowerCase() === wanted),
    elements.filter((e) => nameOf(e).toLowerCase().includes(wanted)),
  ];
  const matches = tiers.find((t) => t.length > 0) ?? [];
  if (matches.length === 0) {
    throw new Error(`Nothing on screen is labeled "${label}". Run \`simple ui\` to see what is.`);
  }
  if (index === undefined) {
    if (matches.length > 1) {
      const list = matches.map((m, i) => `  ${i + 1}. ${m.role} "${nameOf(m)}"`).join("\n");
      throw new Error(`${matches.length} things match "${label}"; pick one with --index:\n${list}`);
    }
    return matches[0] as Element;
  }
  const match = matches[index - 1];
  if (!match) throw new Error(`Only ${matches.length} things match "${label}".`);
  return match;
}

/**
 * Converts a point on screen (in points, current orientation) into the 0–1 coordinates of the panel's native
 * portrait frame, which is what serve-sim's `gesture --raw` takes. serve-sim's own conversion doesn't handle the
 * unfolded Duo, so simple does it.
 */
export function toPanelCoordinates(
  point: { x: number; y: number },
  screen: Screen,
): { x: number; y: number } {
  const x = point.x / screen.width;
  const y = point.y / screen.height;
  switch (screen.orientation) {
    case "landscape_left":
      return { x: y, y: 1 - x };
    case "landscape_right":
      return { x: 1 - y, y: x };
    case "portrait_upside_down":
      return { x: 1 - x, y: 1 - y };
    default:
      return { x, y };
  }
}

/** Compact, one line per element, for people and agents reading the terminal. */
export function formatElements(elements: Element[], screen: Screen): string {
  const lines = elements.map((e) => {
    if (!e.label) {
      // Unlabeled fields and sliders: their value (often a placeholder, like a search field's "Search") is their name.
      return `${e.role.padEnd(12)} "${e.value ?? ""}"${e.enabled ? "" : " (disabled)"}  @ ${e.center.x},${e.center.y}`;
    }
    const value = e.value && e.value !== e.label ? ` = "${e.value}"` : "";
    const disabled = e.enabled ? "" : " (disabled)";
    return `${e.role.padEnd(12)} "${e.label}"${value}${disabled}  @ ${e.center.x},${e.center.y}`;
  });
  return [`Screen ${screen.width}×${screen.height} points, ${screen.orientation}`, ...lines].join(
    "\n",
  );
}

/** What an element is called: its label, or for unlabeled fields its value (e.g. a search field's "Search"). */
export function nameOf(element: Element): string {
  return element.label || element.value || "";
}

/** Whether a model folds (the iPhone Duo). */
export function isFoldable(model: string): boolean {
  return /\bDuo\b/.test(model);
}

/**
 * Which of a foldable's screens is showing. serve-sim reports the hinge angle, but not always (a freshly started
 * helper can leave it out), so fall back to the size of the screen it's streaming: the inner one is much larger
 * (2007×2853 pixels vs the outer one's 1398×2034 on the Duo).
 */
export function innerScreenShowing(config: ScreenConfig): boolean {
  if (config.hingeDegrees !== undefined) return config.hingeDegrees >= 90;
  return Math.max(config.width, config.height) > 2500;
}

/** Hinge angles for the iPhone Duo's poses. */
export const FOLDS: Record<string, number> = { closed: 0, book: 130, open: 180 };

export function foldDegrees(pose: string): number {
  const named = FOLDS[pose.toLowerCase()];
  if (named !== undefined) return named;
  const degrees = Number(pose);
  if (!Number.isFinite(degrees) || degrees < 0 || degrees > 180) {
    throw new Error(`Expected open, book, closed, or an angle from 0 to 180, not "${pose}".`);
  }
  return degrees;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
