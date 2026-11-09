import { useEffect, useState } from "react";
import type { Health } from "../server/server.ts";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main>
      <header>
        <h1>simple</h1>
        {health && <span className="version">{health.version}</span>}
      </header>
      <p className="empty">No simulators to show yet.</p>
    </main>
  );
}
