import React, { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  HardDrive,
  MonitorPlay,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

const FALLBACK_MANAGER_URL = "https://olivier-signage-cockpit-production.up.railway.app/ecran-geant";

export default function DigitalSignage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/signage/status", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      setStatus({ ...payload, healthy: response.ok && payload.healthy === true });
    } catch {
      setStatus({ healthy: false, manager_url: FALLBACK_MANAGER_URL });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const managerUrl = status?.manager_url || FALLBACK_MANAGER_URL;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Signelya"
        subtitle="Application produit JS-Innov.IA pour gérer les clients, écrans, médias, playlists et diffusions"
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-sm">
        <img src="/signelya-brand.png" alt="Signelya — Vos écrans prennent vie" className="mx-auto aspect-[3/2] w-full max-w-5xl object-contain" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><MonitorPlay className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Installation</p>
              <p className="font-semibold">Écran LED 4 m × 2 m</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600"><HardDrive className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contrôleur</p>
              <p className="font-semibold">Colorlight X2M · HDMI</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${status?.healthy ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
              {status?.healthy ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Service Railway</p>
              <p className="font-semibold">
                {loading ? "Vérification…" : status?.healthy ? "Opérationnel" : "Indisponible"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Administration de l’application</h2>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Gérez la médiathèque, l’ordre des playlists, les programmations et le Player Android depuis le service client déjà en production.
            </p>
            <p className="max-w-2xl text-xs text-muted-foreground">
              Le gestionnaire s’ouvre dans un onglet sécurisé séparé. Cette séparation conserve la protection de la session et des médias du client.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadStatus} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualiser l’état
            </Button>
            <Button asChild>
              <a href={managerUrl} target="_blank" rel="noopener noreferrer">
                <MonitorPlay className="mr-2 h-4 w-4" />
                Ouvrir le gestionnaire
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Si le gestionnaire demande une connexion, utilisez le compte Signelya. Une fois la session ouverte sur cet appareil, le module restera directement accessible.
      </div>
    </div>
  );
}
