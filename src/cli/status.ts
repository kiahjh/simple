import type { Group, Simulator, State } from "../simulators.ts";

export type StatusOptions = {
  /** Also list simulators that are off. */
  all: boolean;
  color: boolean;
  /** The dashboard's address when the server is running. */
  dashboard: string | null;
};

const GROUPS: { group: Group; title: string }[] = [
  { group: "you", title: "You" },
  { group: "agents", title: "Agents" },
];

const DOTS: Record<State, string> = { running: "●", starting: "◐", stopping: "◐", off: "○" };
const DOT_COLORS: Record<State, string> = {
  running: "\x1b[32m",
  starting: "\x1b[33m",
  stopping: "\x1b[33m",
  off: "\x1b[2m",
};
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function formatStatus(simulators: Simulator[], options: StatusOptions): string {
  const paint = (code: string, text: string) => (options.color ? `${code}${text}${RESET}` : text);
  const lines: string[] = [];

  for (const { group, title } of GROUPS) {
    const inGroup = simulators.filter((s) => s.group === group);
    const shown = options.all ? inGroup : inGroup.filter((s) => s.state !== "off");
    const hidden = inGroup.length - shown.length;

    lines.push(paint(BOLD, title));
    if (inGroup.length === 0) lines.push(paint(DIM, "  none yet"));

    const columns = shown.map((s) => [s.name, s.model, s.os, describeState(s)] as const);
    const widths = [0, 1, 2].map((i) => Math.max(0, ...columns.map((c) => c[i]?.length ?? 0)));
    shown.forEach((s, row) => {
      const cells = columns[row] ?? [];
      const padded = cells.map((cell, i) => (i < 3 ? cell.padEnd(widths[i] ?? 0) : cell));
      lines.push(`  ${paint(DOT_COLORS[s.state], DOTS[s.state])} ${padded.join("   ")}`.trimEnd());
    });

    if (hidden > 0) {
      lines.push(paint(DIM, `  + ${hidden} off (simple --all to list them)`));
    }
    lines.push("");
  }

  lines.push(
    options.dashboard
      ? `Dashboard: ${options.dashboard}`
      : paint(DIM, "Dashboard: not running (simple dashboard --open)"),
  );
  return lines.join("\n");
}

function describeState(simulator: Simulator): string {
  if (!simulator.available) return "unavailable (runtime not installed)";
  return simulator.state;
}
