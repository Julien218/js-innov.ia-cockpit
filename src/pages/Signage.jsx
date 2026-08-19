import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Monitor, Wifi, CalendarClock, Radio, Cable, Film, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const labels = { ok: 'OK', error: 'ERROR', unmeasured: 'NON MESURÉ' };
const tone = { ok: 'text-emerald-600 bg-emerald-50', error: 'text-red-600 bg-red-50', unmeasured: 'text-amber-700 bg-amber-50' };
const metrics = [
  ['player','PLAYER',Monitor], ['network','NETWORK',Wifi], ['schedule','SCHEDULE',CalendarClock],
  ['publication','PUBLICATION',Radio], ['hdmi','HDMI',Cable], ['content','CONTENT',Film],
];

async function load() {
  const r = await fetch('/api/signage-central/overview', { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error(`Diagnostic indisponible (${r.status})`);
  return r.json();
}

export default function Signage() {
  const q = useQuery({ queryKey:['signage-central'], queryFn:load, refetchInterval:15000, staleTime:5000 });
  const players = q.data?.players || [];
  return <div className="p-4 md:p-6 space-y-5">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Écrans & Signage</h1><p className="text-sm text-muted-foreground">Supervision en direct depuis le service Signage Railway.</p></div>
      <Button variant="outline" onClick={()=>q.refetch()} disabled={q.isFetching}><RefreshCw className={`w-4 h-4 mr-2 ${q.isFetching?'animate-spin':''}`}/>Actualiser</Button>
    </div>
    {q.isError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{q.error.message}</div>}
    {!q.isLoading && !q.isError && players.length===0 && <div className="rounded-xl border p-6 text-muted-foreground">Aucun écran retourné par l’API Signage.</div>}
    {players.map(p => <Card key={p.id || p.name}>
      <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle>{p.name}</CardTitle><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${p.online?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>{p.online?'EN LIGNE':'HORS LIGNE'}</span></div><div className="text-xs text-muted-foreground">{p.installation || 'Installation'} · Pixelium {p.version || 'version non remontée'} · dernier signal {p.lastSeen ? new Date(p.lastSeen).toLocaleString('fr-BE') : 'inconnu'}</div></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">{metrics.map(([k,l,I])=>{const s=p.diagnostics?.[k]||'unmeasured';return <div key={k} className={`rounded-xl p-3 ${tone[s]||tone.unmeasured}`}><I className="w-4 h-4 mb-2"/><div className="text-[10px] font-semibold tracking-wide">{l}</div><div className="text-sm font-bold">{labels[s]||labels.unmeasured}</div></div>})}</div>
        <div className="rounded-2xl bg-black text-white aspect-video max-w-3xl flex items-center justify-center overflow-hidden">
          {p.currentMedia?.url ? (String(p.currentMedia.type||'').startsWith('image') ? <img src={p.currentMedia.url} className="w-full h-full object-contain"/> : <video src={p.currentMedia.url} className="w-full h-full object-contain" autoPlay muted loop playsInline/>) : <div className="text-center text-white/60"><Monitor className="w-10 h-10 mx-auto mb-2"/><p>Aperçu synchronisé</p><p className="text-xs">Le Player ne remonte pas encore le média courant.</p></div>}
        </div>
        <p className="text-xs text-muted-foreground">« NON MESURÉ » signifie absence de télémétrie, jamais une panne. PLAYER et NETWORK sont calculés à partir du dernier heartbeat réel (seuil 90 s).</p>
      </CardContent>
    </Card>)}
  </div>;
}
