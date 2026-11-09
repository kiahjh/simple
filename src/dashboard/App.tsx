import { useEffect, useState } from "react";
import { readMjpegFrames } from "../mjpeg.ts";
import type { Health, SimulatorsResponse } from "../server/server.ts";
import type { Group, Simulator } from "../simulators.ts";

const REFRESH_MS = 2000;

const GROUPS: { group: Group; title: string }[] = [
  { group: "you", title: "Yours" },
  { group: "agents", title: "Agents'" },
];

export function App() {
  const health = useHealth();
  const { simulators, error } = useSimulators();

  return (
    <main>
      <header>
        <h1>simple</h1>
        {health && <span className="version">{health.version}</span>}
      </header>
      {error && <p className="error">{error}</p>}
      {simulators &&
        GROUPS.map(({ group, title }) => (
          <GroupSection
            key={group}
            title={title}
            simulators={simulators.filter((s) => s.group === group)}
          />
        ))}
    </main>
  );
}

function GroupSection({ title, simulators }: { title: string; simulators: Simulator[] }) {
  const running = simulators.filter((s) => s.state !== "off");
  const off = simulators.filter((s) => s.state === "off");

  return (
    <section>
      <h2>{title}</h2>
      {simulators.length === 0 && <p className="muted">None yet.</p>}
      {running.length > 0 && (
        <div className="cards">
          {running.map((s) => (
            <SimulatorCard key={s.udid} simulator={s} />
          ))}
        </div>
      )}
      {off.length > 0 && (
        <details className="off-list">
          <summary>{off.length} off</summary>
          <ul>
            {off.map((s) => (
              <li key={s.udid}>
                <span className="dot off" />
                <span className="name">{s.name}</span>
                <span className="model">{s.model}</span>
                <span className="muted">{s.os}</span>
                {!s.available && <span className="muted">unavailable (runtime not installed)</span>}
                <CopyId udid={s.udid} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function SimulatorCard({ simulator: s }: { simulator: Simulator }) {
  return (
    <article className="card">
      <div className="thumbnail">
        {s.state === "running" ? (
          <Thumbnail udid={s.udid} name={s.name} />
        ) : (
          <span className="muted">{s.state === "starting" ? "Starting…" : "Stopping…"}</span>
        )}
      </div>
      <div className="details">
        <div className="title">
          <span className="name">{s.name}</span>
          <CopyId udid={s.udid} />
        </div>
        <div>
          <span className="model">{s.model}</span> <span className="muted">· {s.os}</span>
        </div>
        <div className="state">
          <span className={`dot ${s.state}`} />
          {s.state}
        </div>
      </div>
    </article>
  );
}

/**
 * A live, low-frame-rate view of the simulator's screen. Reads the stream itself rather than using an
 * `<img src>` for it, because browsers silently stop updating an image stream that ends (for example when the
 * simulator restarts). This notices the end and reconnects.
 */
function Thumbnail({ udid, name }: { udid: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let stopped = false;
    let abort: AbortController | null = null;
    // Keep the shown frame's URL and the one before it; older ones are revoked.
    const urls: string[] = [];

    const run = async () => {
      let delay = 1000;
      while (!stopped) {
        abort = new AbortController();
        try {
          const res = await fetch(`/api/simulators/${udid}/thumbnail`, { signal: abort.signal });
          if (!res.ok || !res.body) throw new Error(`thumbnail answered ${res.status}`);
          for await (const frame of readMjpegFrames(res.body)) {
            if (stopped) break;
            const url = URL.createObjectURL(
              new Blob([frame as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
            );
            urls.push(url);
            while (urls.length > 2) URL.revokeObjectURL(urls.shift() as string);
            setSrc(url);
            setLive(true);
            delay = 1000;
          }
        } catch {
          // Fall through to reconnecting.
        }
        if (stopped) break;
        setLive(false);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 10_000);
      }
    };
    run();

    return () => {
      stopped = true;
      abort?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [udid]);

  return (
    <>
      {src && <img className="screen" src={src} alt={`${name}'s screen`} />}
      {!live && <span className="badge">{src ? "Reconnecting…" : "Connecting…"}</span>}
    </>
  );
}

function CopyId({ udid }: { udid: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(udid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button type="button" className="copy" title={udid} onClick={copy}>
      {copied ? "Copied" : "Copy ID"}
    </button>
  );
}

function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  return health;
}

/** The simulator list, refreshed every couple of seconds. Keeps the last good list while erroring. */
function useSimulators(): { simulators: Simulator[] | null; error: string | null } {
  const [simulators, setSimulators] = useState<Simulator[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch("/api/simulators");
        const body = (await res.json()) as SimulatorsResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
        setSimulators(body.simulators);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const unreachable = e instanceof TypeError;
        setError(
          unreachable
            ? "Can't reach the simple server. Run `simple dashboard` to start it."
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { simulators, error };
}
