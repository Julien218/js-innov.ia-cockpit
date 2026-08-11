import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import { MonitorPlay, Upload, ListVideo, CalendarClock, Wifi, HardDrive, RotateCcw } from "lucide-react";

const StatusCard = ({ icon: Icon, label, value, detail }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  </div>
);

export default function DigitalSignage() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Écran géant"
        subtitle="Pilotage à distance du contenu diffusé sur l'écran LED via le Player JS-Innov.IA et le contrôleur Colorlight X2M."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard icon={Wifi} label="Player" value="À connecter" detail="Heartbeat sécurisé requis" />
        <StatusCard icon={MonitorPlay} label="Contrôleur LED" value="Colorlight X2M" detail="Sortie Player en HDMI" />
        <StatusCard icon={HardDrive} label="Médiathèque" value="Dropbox client" detail="Cache local offline-first" />
        <StatusCard icon={RotateCcw} label="Rollback" value="Automatique" detail="Dernière campagne valide" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold">Diffusion actuelle</h2>
              <p className="text-xs text-muted-foreground mt-1">Le Player continuera la dernière playlist valide même en cas de coupure Internet.</p>
            </div>
            <span className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-foreground">En attente de connexion</span>
          </div>
          <div className="aspect-video rounded-xl border border-dashed border-border bg-muted/30 flex items-center justify-center text-center p-6">
            <div>
              <MonitorPlay className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Aucune prévisualisation disponible</p>
              <p className="text-xs text-muted-foreground mt-1">La prévisualisation s'activera dès qu'un média sera synchronisé.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Actions</h2>
          <button className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-medium flex items-center justify-center gap-2">
            <Upload className="w-4 h-4" /> Ajouter une vidéo
          </button>
          <button className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted">
            <ListVideo className="w-4 h-4" /> Gérer la playlist
          </button>
          <button className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted">
            <CalendarClock className="w-4 h-4" /> Programmer une diffusion
          </button>
          <p className="text-xs text-muted-foreground pt-2">Pipeline cible : upload → validation → transcodage FFmpeg → téléchargement Player → vérification → bascule → confirmation.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Architecture de diffusion</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-center text-xs">
          {["Cockpit", "Dropbox / Railway", "Player local", "HDMI → X2M", "Écran LED 4 × 2 m"].map((step, index) => (
            <div key={step} className="rounded-xl border border-border px-3 py-4 bg-muted/20">
              <span className="text-muted-foreground mr-1">{index + 1}.</span>{step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
