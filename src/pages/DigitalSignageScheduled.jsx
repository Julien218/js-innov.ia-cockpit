import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import DigitalSignage from "@/pages/DigitalSignage";
import SignageSchedulePanel from "@/components/signage/SignageSchedulePanel";
import SignageMediaManager from "@/components/signage/SignageMediaManager";
import SignageDisplayManager from "@/components/signage/SignageDisplayManager";
import ScreenCameraProof from "@/components/signage/ScreenCameraProof";
import SignelyaPriorityPlayer from "@/components/signage/SignelyaPriorityPlayer";
import { useAuth } from "@/lib/AuthContext";
import "./signelya-dashboard-v2.css";

const MANAGED_CLIENT_KEY = "jsinnovia-managed-client";

async function fetchDashboard(clientEmail = "") {
  const response = await fetch("/api/signage/manage/dashboard", {
    credentials: "same-origin",
    headers: clientEmail ? { "X-Client-Email": clientEmail } : {},
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
  const [managedClient, setManagedClient] = React.useState(() =>
    isAdmin ? (window.localStorage.getItem(MANAGED_CLIENT_KEY) || "") : "",
  );
  const [actionError, setActionError] = React.useState("");

  React.useEffect(() => {
    if (!isAdmin) return undefined;

    const sync = () => {
      const nextClient = window.localStorage.getItem(MANAGED_CLIENT_KEY) || "";
      setManagedClient(previous => {
        if (previous === nextClient) return previous;
        setActionError("");
        return nextClient;
      });
    };

    const timer = window.setInterval(sync, 1000);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", sync);
    };
  }, [isAdmin]);

  const dashboardEnabled = !isAdmin || Boolean(managedClient);
  const dashboardQuery = useQuery({
    queryKey: ["signage-dashboard", managedClient || "self"],
    queryFn: () => fetchDashboard(managedClient),
    enabled: dashboardEnabled,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const dashboard = dashboardQuery.data || null;
  const players = dashboard?.players || [];
  const player = [...players].sort(
    (a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime(),
  )[0] || null;

  const openUpload = React.useCallback(() => {
    const input = document.querySelector('.signelya-legacy-dashboard input[type="file"]');
    if (input && typeof input.click === "function") {
      setActionError("");
      input.click();
      return;
    }
    setActionError("Le module d’envoi n’est pas encore prêt. Rechargez la page puis réessayez.");
  }, []);

  const uploadDisabled = isAdmin && !managedClient;
  const visibleError = actionError || dashboardQuery.error?.message || "";

  return (
    <div className="signelya-dashboard-v2 signelya-priority-layout" data-signelya-page>
      <SignelyaPriorityPlayer
        clientEmail={managedClient}
        isAdmin={isAdmin}
        dashboardData={dashboard}
      />

      <div className="mx-auto w-full max-w-[1600px] px-4 pt-4 md:px-6">
        <section className="flex flex-col gap-4 rounded-2xl border border-fuchsia-400/30 bg-[linear-gradient(120deg,rgba(0,212,255,.08),rgba(8,125,255,.08)_38%,rgba(138,43,226,.12)_72%,rgba(255,43,214,.08))] p-4 shadow-[0_0_24px_rgba(138,43,226,.09)] sm:flex-row sm:items-center sm:justify-between md:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#00d4ff,#087dff_42%,#8a2be2_76%,#ff2bd6)] text-white shadow-[0_0_20px_rgba(0,212,255,.24)]">
              <Upload className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold md:text-lg">Ajouter vos vidéos</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Importez une vidéo ou une image dans la médiathèque SIGNELYA.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openUpload}
            disabled={uploadDisabled}
            className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/20 bg-[linear-gradient(110deg,#00d4ff,#087dff_38%,#8a2be2_72%,#ff2bd6)] px-5 py-3 text-sm font-bold text-white shadow-[0_0_22px_rgba(0,212,255,.20)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            <Upload className="h-4 w-4" />
            Ajouter une vidéo ou une image
          </button>
        </section>

        {player && (
          <section className="mt-4 rounded-2xl border border-cyan-500/20 bg-card p-3 shadow-sm md:p-4">
            <SignageDisplayManager
              player={player}
              managedClient={managedClient}
              dashboardData={dashboard}
              summaryOnly
            />
          </section>
        )}

        <div className="mt-4">
          <ScreenCameraProof
            managedClient={managedClient}
            enabled={dashboardEnabled}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      <div className="signelya-legacy-dashboard">
        <DigitalSignage />
      </div>

      <div className="mx-auto max-w-7xl space-y-4 px-4 pb-6 md:px-6">
        {visibleError && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            {visibleError}
          </div>
        )}

        {player && (
          <details className="rounded-2xl border bg-card">
            <summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">
              Définir les horaires automatiques
            </summary>
            <div className="border-t p-3 md:p-4">
              <SignageSchedulePanel player={player} managedClient={managedClient} />
            </div>
          </details>
        )}

        <details className="rounded-2xl border bg-card">
          <summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">
            Gérer ou supprimer des fichiers
          </summary>
          <div className="border-t p-3 md:p-4">
            {(!isAdmin || managedClient) ? (
              <SignageMediaManager managedClient={managedClient} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Sélectionnez d’abord le client dont vous souhaitez gérer les fichiers.
              </p>
            )}
          </div>
        </details>

        {isAdmin && player && (
          <details className="rounded-2xl border bg-card">
            <summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">
              Diagnostic avancé de l’écran
            </summary>
            <div className="border-t p-3 md:p-4">
              <SignageDisplayManager player={player} managedClient={managedClient} dashboardData={dashboard} />
            </div>
          </details>
        )}

        {!player && !visibleError && (
          <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            {isAdmin && !managedClient
              ? "Sélectionnez un client pour accéder à ses horaires et diagnostics."
              : "Les horaires seront disponibles dès que l’écran sera associé."}
          </div>
        )}
      </div>
    </div>
  );
}
