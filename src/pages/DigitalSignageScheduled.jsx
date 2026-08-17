import React from "react";
import DigitalSignage from "@/pages/DigitalSignage";
import SignageSchedulePanel from "@/components/signage/SignageSchedulePanel";
import SignageMediaManager from "@/components/signage/SignageMediaManager";
import { useAuth } from "@/lib/AuthContext";

const MANAGED_CLIENT_KEY = "jsinnovia-managed-client";

async function fetchDashboard(clientEmail = "") {
  const response = await fetch("/api/signage/manage/dashboard", {
    credentials: "same-origin",
    headers: clientEmail ? { "X-Client-Email": clientEmail } : {}
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new Error("Réponse du cockpit illisible"); }
  }
  if (!response.ok) throw new Error(body.error || "Impossible de charger le Player");
  return body;
}

export default function DigitalSignageScheduled() {
  const { user } = useAuth();
  const isAdmin = ["admin", "superadmin"].includes(user?.role);
  const [managedClient, setManagedClient] = React.useState(() => isAdmin ? (window.localStorage.getItem(MANAGED_CLIENT_KEY) || "") : "");
  const [player, setPlayer] = React.useState(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!isAdmin) return;
    const sync = () => setManagedClient(window.localStorage.getItem(MANAGED_CLIENT_KEY) || "");
    const timer = window.setInterval(sync, 1000);
    window.addEventListener("storage", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", sync); };
  }, [isAdmin]);

  React.useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      if (isAdmin && !managedClient) { setPlayer(null); return; }
      try {
        const data = await fetchDashboard(managedClient);
        if (cancelled) return;
        const players = Array.isArray(data.players) ? data.players : [];
        const selected = [...players].sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime())[0] || null;
        setPlayer(selected);
        setError("");
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) timer = window.setTimeout(load, 30000);
    };
    load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [isAdmin, managedClient]);

  return <>
    <DigitalSignage />
    <div className="px-4 md:px-6 pb-6 max-w-7xl mx-auto space-y-4">
      {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700">{error}</div>}
      <SignageMediaManager managedClient={managedClient} />
      {player ? <SignageSchedulePanel player={player} managedClient={managedClient} /> : <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Le calendrier sera disponible dès qu’un Player est associé à ce client.</div>}
    </div>
  </>;
}
