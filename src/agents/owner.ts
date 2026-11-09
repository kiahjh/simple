import { basename } from "node:path";

export type Owner = {
  /** Stable identity for claims: "opencode:<session>", "named:<name>", or "you". */
  id: string;
  /** What people see. */
  label: string;
};

/**
 * Who is running this command. An OpenCode agent is identified by its session (OpenCode sets
 * `OPENCODE_SESSION_ID` in agent shells) and labeled with its project folder. Other tools can pass a name
 * (`--owner`, or `SIMPLE_OWNER`). Anyone else is the person: "you".
 */
export function currentOwner(name?: string): Owner {
  const named = name ?? process.env.SIMPLE_OWNER;
  if (named) return { id: `named:${named}`, label: named };
  const session = process.env.OPENCODE_SESSION_ID;
  if (session) return { id: `opencode:${session}`, label: projectName() };
  return { id: "you", label: "you" };
}

function projectName(): string {
  const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stderr: "ignore" });
  const root = git.exitCode === 0 ? git.stdout.toString().trim() : process.cwd();
  return basename(root) || "agent";
}
