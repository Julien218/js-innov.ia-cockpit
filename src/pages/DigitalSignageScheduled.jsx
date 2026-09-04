import React from "react";
import DigitalSignage from "@/pages/DigitalSignage";
import SignageSchedulePanel from "@/components/signage/SignageSchedulePanel";
import SignageMediaManager from "@/components/signage/SignageMediaManager";
import SignageDisplayManager from "@/components/signage/SignageDisplayManager";
import SignelyaPriorityPlayer from "@/components/signage/SignelyaPriorityPlayer";
import { useAuth } from "@/lib/AuthContext";
import "./signelya-dashboard-v2.css";

const MANAGED_CLIENT_KEY = "jsinnovia-managed-client";

async function fetchDashboard(clientEmail = "") {
  const response = await fetch("/api/signage/manage/dashboard", { credentials: "same-origin", headers: clientEmail ? { "X-Client-Email": clientEmail } : {} });
  const text = await response.text();
  let body = {};
  if (text) { try { body = JSON.parse(text); } catch { throw new Error("Réponse du cockpit illisible"); } }
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
    let cancelled = false; let timer;
    const load = async () => {
      if (isAdmin && !managedClient) { setPlayer(null); return; }
      try { const data = await fetchDashboard(managedClient); if (cancelled) return; const players = Array.isArray(data.players) ? data.players : []; setPlayer([...players].sort((a,b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null); setError(""); }
      catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) timer = window.setTimeout(load, 30000);
    };
    load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [isAdmin, managedClient]);

  return <div className="signelya-dashboard-v2 signelya-priority-layout" data-signelya-page>
    <SignelyaPriorityPlayer clientEmail={managedClient} isAdmin={isAdmin} />
    <div className="signelya-legacy-dashboard"><DigitalSignage /></div>
    <div className="px-4 md:px-6 pb-6 max-w-7xl mx-auto space-y-4">
      {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {player && <details className="rounded-2xl border bg-card"><summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">Définir les horaires automatiques</summary><div className="border-t p-3 md:p-4"><SignageSchedulePanel player={player} managedClient={managedClient} /></div></details>}
      <details className="rounded-2xl border bg-card"><summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">Gérer ou supprimer des fichiers</summary><div className="border-t p-3 md:p-4">{(!isAdmin || managedClient) ? <SignageMediaManager managedClient={managedClient} /> : <p className="text-sm text-muted-foreground">Sélectionnez d’abord le client dont vous souhaitez gérer les fichiers.</p>}</div></details>
      {isAdmin && player && <details className="rounded-2xl border bg-card"><summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">Diagnostic avancé de l’écran</summary><div className="border-t p-3 md:p-4"><SignageDisplayManager player={player} managedClient={managedClient} /></div></details>}
      {!player && <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Les horaires seront disponibles dès que l’écran sera associé.</div>}
    </div>
  </div>;
}
