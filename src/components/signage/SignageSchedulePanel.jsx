import React from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";

const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const emptyWeek = () => DAYS.flatMap((_, day) => day === 0 || day === 6 ? [] : [{ day_of_week: day, start_time: "08:00", end_time: "18:00" }]);

async function call(path, options = {}, clientEmail = "") {
  const response = await fetch(`/api/signage${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(clientEmail ? { "X-Client-Email": clientEmail } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new Error("Réponse de planification illisible"); }
  }
  if (!response.ok) throw new Error(body.error || "Planification impossible");
  return body;
}

export default function SignageSchedulePanel({ player, managedClient = "" }) {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [configured, setConfigured] = React.useState(false);
  const [blockHolidays, setBlockHolidays] = React.useState(true);
  const [ranges, setRanges] = React.useState([]);
  const [exceptions, setExceptions] = React.useState([]);
  const [exceptionDate, setExceptionDate] = React.useState("");
  const [exceptionMode, setExceptionMode] = React.useState("closed");
  const [exceptionStart, setExceptionStart] = React.useState("08:00");
  const [exceptionEnd, setExceptionEnd] = React.useState("18:00");

  const load = React.useCallback(async () => {
    if (!player?.id) return;
    setLoading(true); setMessage("");
    try {
      const data = await call(`/manage/players/${player.id}/schedule`, {}, managedClient);
      setConfigured(Boolean(data.settings?.configured));
      setBlockHolidays(data.settings?.block_belgian_holidays !== false);
      setRanges(Array.isArray(data.ranges) && data.ranges.length ? data.ranges.map(r => ({ day_of_week: Number(r.day_of_week), start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) })) : []);
      setExceptions(data.exceptions || []);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, [player?.id, managedClient]);

  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!player?.id) return;
    setSaving(true); setMessage("");
    try {
      await call(`/manage/players/${player.id}/schedule`, {
        method: "PUT",
        body: JSON.stringify({ configured, blockBelgianHolidays: blockHolidays, ranges })
      }, managedClient);
      setMessage("Horaires enregistrés. Aucun nouveau jeton Player n’est nécessaire.");
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  const addRange = day => setRanges(current => [...current, { day_of_week: day, start_time: "08:00", end_time: "18:00" }]);
  const updateRange = (index, key, value) => setRanges(current => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const removeRange = index => setRanges(current => current.filter((_, i) => i !== index));

  const addException = async () => {
    if (!exceptionDate || !player?.id) return;
    setSaving(true); setMessage("");
    try {
      await call(`/manage/players/${player.id}/exceptions`, {
        method: "POST",
        body: JSON.stringify({
          date: exceptionDate,
          mode: exceptionMode,
          ranges: exceptionMode === "special_hours" ? [{ start_time: exceptionStart, end_time: exceptionEnd }] : []
        })
      }, managedClient);
      setExceptionDate("");
      setMessage("Exception calendrier enregistrée.");
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  const removeException = async id => {
    setSaving(true); setMessage("");
    try {
      await call(`/manage/players/${player.id}/exceptions/${id}`, { method: "DELETE" }, managedClient);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  if (!player) return null;
  return <div className="rounded-2xl border bg-card p-5 space-y-5">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><CalendarClock className="w-5 h-5" /></div>
      <div className="flex-1"><h2 className="text-sm font-semibold">Calendrier de diffusion publicitaire</h2><p className="text-xs text-muted-foreground mt-1">Fuseau Europe/Brussels. Les jours fériés belges peuvent être exclus automatiquement. L’installation et le jeton Player existants restent inchangés.</p></div>
    </div>

    {message && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">{message}</div>}

    <div className="flex flex-wrap gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={configured} onChange={e => setConfigured(e.target.checked)} /> Activer les horaires</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={blockHolidays} onChange={e => setBlockHolidays(e.target.checked)} /> Bloquer les jours fériés belges</label>
      {!ranges.length && <button type="button" onClick={() => setRanges(emptyWeek())} className="rounded-lg border px-3 py-1.5 text-xs">Préremplir lun–ven</button>}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {DAYS.map((day, dayIndex) => <div key={day} className="rounded-xl border p-3">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">{day}</p><button type="button" onClick={() => addRange(dayIndex)} className="rounded-lg border p-1.5" aria-label={`Ajouter une plage ${day}`}><Plus className="w-3.5 h-3.5" /></button></div>
        <div className="mt-2 space-y-2">{ranges.map((range, index) => range.day_of_week === dayIndex ? <div key={`${dayIndex}-${index}`} className="flex items-center gap-1"><input type="time" value={range.start_time} onChange={e => updateRange(index, "start_time", e.target.value)} className="min-w-0 w-full rounded-lg border bg-background px-2 py-1.5 text-xs"/><span className="text-xs">–</span><input type="time" value={range.end_time} onChange={e => updateRange(index, "end_time", e.target.value)} className="min-w-0 w-full rounded-lg border bg-background px-2 py-1.5 text-xs"/><button type="button" onClick={() => removeRange(index)} className="p-1 text-muted-foreground" aria-label="Supprimer"><Trash2 className="w-3.5 h-3.5"/></button></div> : null)}{!ranges.some(r => r.day_of_week === dayIndex) && <p className="text-xs text-muted-foreground">Aucune publicité</p>}</div>
      </div>)}
    </div>

    <button disabled={saving || loading} onClick={save} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer les horaires"}</button>

    <div className="border-t pt-4 space-y-3">
      <div><h3 className="text-sm font-semibold">Exceptions calendrier</h3><p className="text-xs text-muted-foreground">Une exception manuelle est prioritaire sur les jours fériés et le planning hebdomadaire.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <input type="date" value={exceptionDate} onChange={e => setExceptionDate(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm" />
        <select value={exceptionMode} onChange={e => setExceptionMode(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm"><option value="closed">Fermé — aucune pub</option><option value="special_hours">Horaires spéciaux</option><option value="normal">Horaire normal, même férié</option></select>
        {exceptionMode === "special_hours" && <><input type="time" value={exceptionStart} onChange={e => setExceptionStart(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm"/><input type="time" value={exceptionEnd} onChange={e => setExceptionEnd(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm"/></>}
        <button disabled={saving || !exceptionDate} onClick={addException} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">Ajouter</button>
      </div>
      <div className="divide-y rounded-xl border">{exceptions.map(item => <div key={item.id} className="flex items-center gap-3 p-3"><div className="flex-1"><p className="text-sm font-medium">{new Date(`${item.exception_date}T12:00:00`).toLocaleDateString("fr-BE")} · {item.mode === "closed" ? "Aucune publicité" : item.mode === "normal" ? "Horaire normal" : "Horaires spéciaux"}</p>{item.mode === "special_hours" && <p className="text-xs text-muted-foreground">{(item.ranges || []).map(r => `${String(r.start_time || r.startTime).slice(0,5)}–${String(r.end_time || r.endTime).slice(0,5)}`).join(", ")}</p>}</div><button type="button" disabled={saving} onClick={() => removeException(item.id)} className="rounded-lg border p-2" aria-label="Supprimer l’exception"><Trash2 className="w-4 h-4"/></button></div>)}{!exceptions.length && <p className="p-3 text-xs text-muted-foreground">Aucune exception programmée.</p>}</div>
    </div>
  </div>;
}
