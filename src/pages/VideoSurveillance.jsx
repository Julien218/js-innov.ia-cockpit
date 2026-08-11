import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Camera, Video, Wifi, HardDrive, ShieldCheck, Clock3 } from "lucide-react";

const CameraCard = ({ name }) => (
  <div className="rounded-2xl border border-border bg-card overflow-hidden">
    <div className="aspect-video bg-muted/30 flex items-center justify-center">
      <Camera className="w-10 h-10 text-muted-foreground" />
    </div>
    <div className="p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted-foreground">CTRONICS CTIPC-690C-2MPW</p>
      </div>
      <span className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-foreground">À connecter</span>
    </div>
  </div>
);

export default function VideoSurveillance() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Vidéosurveillance"
        subtitle="Vue sécurisée des caméras du client, enregistrements et archivage Dropbox."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4"><Wifi className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Passerelle locale</p><p className="text-sm font-semibold">À connecter</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><Video className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Flux direct</p><p className="text-sm font-semibold">RTSP via proxy sécurisé</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><HardDrive className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Archivage</p><p className="text-sm font-semibold">Dropbox client</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><ShieldCheck className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Sécurité</p><p className="text-sm font-semibold">Aucun RTSP exposé</p></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Caméras</h2>
          <span className="text-xs text-muted-foreground">Configuration initiale requise</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CameraCard name="Caméra 01" />
          <CameraCard name="Caméra 02" />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Historique des enregistrements</h2>
        </div>
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">Aucun enregistrement synchronisé</p>
          <p className="text-xs text-muted-foreground mt-1">Les clips enregistrés seront indexés ici par caméra, date, durée et chemin Dropbox.</p>
        </div>
      </div>
    </div>
  );
}
