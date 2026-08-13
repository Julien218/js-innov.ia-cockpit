import React from "react";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { Camera, Video, Wifi, HardDrive, ShieldCheck, Clock3 } from "lucide-react";

export default function VideoSurveillance() {
  const { data = { cameras: [] }, error, isLoading } = useQuery({ queryKey: ["signage-cameras"], queryFn: async () => { const r = await fetch('/api/signage/manage/cameras', { credentials: 'same-origin' }); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Caméras indisponibles'); return b; }, refetchInterval: 30000 });
  return <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto"><PageHeader title="Vidéosurveillance" subtitle="Vue sécurisée des caméras autorisées de Pixelium. Aucun flux RTSP n’est exposé sur Internet." />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"><div className="rounded-2xl border p-4"><Wifi className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Passerelle locale</p><p className="text-sm font-semibold">{data.cameras.length ? 'Configurée' : 'À connecter'}</p></div><div className="rounded-2xl border p-4"><Video className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Caméras</p><p className="text-sm font-semibold">{data.cameras.length}</p></div><div className="rounded-2xl border p-4"><HardDrive className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Archivage</p><p className="text-sm font-semibold">Dropbox Pixelium</p></div><div className="rounded-2xl border p-4"><ShieldCheck className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Sécurité</p><p className="text-sm font-semibold">Passerelle privée</p></div></div>
    {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{error.message}</div>}
    <div><h2 className="text-sm font-semibold mb-3">Caméras</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{data.cameras.map(c => <div key={c.id} className="rounded-2xl border overflow-hidden"><div className="aspect-video bg-muted/30 flex items-center justify-center"><Camera className="w-10 h-10 text-muted-foreground"/></div><div className="p-4"><p className="font-semibold">{c.name}</p><p className="text-xs text-muted-foreground">{c.model || 'CTRONICS'}</p></div></div>)}{!isLoading && !data.cameras.length && <div className="col-span-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune caméra enregistrée. La passerelle locale sera associée lors de l’installation sur site.</div>}</div></div>
    <div className="rounded-2xl border p-5"><div className="flex items-center gap-2"><Clock3 className="w-4 h-4 text-primary"/><h2 className="text-sm font-semibold">Enregistrements</h2></div><p className="text-xs text-muted-foreground mt-2">L’index des clips apparaîtra après la première synchronisation de la passerelle.</p></div>
  </div>;
}

