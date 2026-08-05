import React, { useState, useEffect, useCallback } from "react";
import {
  Send, Inbox, Clock, AlertTriangle, BarChart3, FileText,
  Settings, RefreshCw, Loader2, CheckCircle2,
  XCircle, Plus, Trash2, Edit, X
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

const STATUS_COLORS = {
  sent:        { bg: "#0a2e1a", text: "#10b981", dot: "#10b981" },
  pending:     { bg: "#2e2e0a", text: "#f59e0b", dot: "#f59e0b" },
  sending:     { bg: "#0a1a2e", text: "#3b82f6", dot: "#3b82f6" },
  failed:      { bg: "#2e0a0a", text: "#ef4444", dot: "#ef4444" },
  retry:       { bg: "#2e1a0a", text: "#f97316", dot: "#f97316" },
  cancelled:   { bg: "#1a1a1a", text: "#6b7280", dot: "#6b7280" },
  dead_letter: { bg: "#2e0a2e", text: "#a855f7", dot: "#a855f7" },
};

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />{status}
    </span>
  );
}

function timeAgo(d) { if (!d) return "—"; const s=(Date.now()-new Date(d).getTime())/1000; if(s<60)return "à l'instant"; if(s<3600)return `il y a ${Math.floor(s/60)} min`; if(s<86400)return `il y a ${Math.floor(s/3600)} h`; return new Date(d).toLocaleDateString("fr-BE",{day:"2-digit",month:"short"}); }
function fmtDate(d) { return d?new Date(d).toLocaleString("fr-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"; }

async function apiFetch(path, opts={}) {
  const r = await fetch(path, { ...opts, credentials:"same-origin", headers:{"Content-Type":"application/json",...(opts.headers||{})} });
  if (!r.ok) { const e=await r.json().catch(()=>({error:r.statusText})); throw new Error(e.error||`HTTP ${r.status}`); }
  return r.json();
}

const TABS = [
  { id:"send", label:"Boîte d'envoi", icon:Send },
  { id:"history", label:"Historique", icon:Inbox },
  { id:"queue", label:"File d'attente", icon:Clock },
  { id:"errors", label:"Erreurs", icon:AlertTriangle },
  { id:"stats", label:"Statistiques", icon:BarChart3 },
  { id:"templates", label:"Templates", icon:FileText },
  { id:"settings", label:"Paramètres", icon:Settings },
];

export default function EmailCore() {
  const [activeTab, setActiveTab] = useState("history");
  return (
    <div className="min-h-screen bg-[#0B0B0F] text-gray-100">
      <PageHeader title="Email Core Framework" subtitle="Service central d'envoi d'emails — multi-marques" />
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto border-b border-gray-800">
        {TABS.map((t) => { const Icon=t.icon; const a=activeTab===t.id; return (
          <button key={t.id} onClick={()=>setActiveTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${a?"bg-[#0F172A] text-[#D4AF37] border-b-2 border-[#D4AF37]":"text-gray-400 hover:text-gray-200 hover:bg-gray-900"}`}>
            <Icon size={16} />{t.label}
          </button>
        ); })}
      </div>
      <div className="p-4">
        {activeTab==="send" && <SendTab />}
        {activeTab==="history" && <HistoryTab />}
        {activeTab==="queue" && <QueueTab />}
        {activeTab==="errors" && <ErrorsTab />}
        {activeTab==="stats" && <StatsTab />}
        {activeTab==="templates" && <TemplatesTab />}
        {activeTab==="settings" && <SettingsTab />}
      </div>
    </div>
  );
}

function SendTab() {
  const [brands,setBrands]=useState([]); const [templates,setTemplates]=useState([]);
  const [sending,setSending]=useState(false); const [result,setResult]=useState(null);
  const [f,setF]=useState({brand:"",to:"",cc:"",bcc:"",subject:"",text:"",html:"",useHtml:false,template:"",idempotencyKey:""});
  useEffect(()=>{apiFetch("/api/emails/brands").then(setBrands).catch(()=>{});},[]);
  useEffect(()=>{if(f.brand){apiFetch(`/api/emails/templates?brand=${f.brand}`).then(d=>setTemplates(d||[])).catch(()=>setTemplates([]));}},[f.brand]);
  const submit=async(e)=>{e.preventDefault();setSending(true);setResult(null);
    try{const body={brand:f.brand,to:f.to,cc:f.cc||undefined,bcc:f.bcc||undefined,subject:f.subject,text:f.useHtml?undefined:f.text,html:f.useHtml?f.html:undefined,template:f.template||undefined};
      const headers={}; if(f.idempotencyKey)headers["Idempotency-Key"]=f.idempotencyKey;
      const r=await apiFetch("/api/emails/send",{method:"POST",headers,body:JSON.stringify(body)});
      setResult({success:true,...r});
    }catch(err){setResult({success:false,error:err.message});}
    setSending(false);
  };
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <div><label className="block text-sm text-gray-400 mb-1">Marque</label>
        <select value={f.brand} onChange={e=>setF({...f,brand:e.target.value})} required className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#D4AF37]">
          <option value="">— Sélectionner —</option>{brands.map(b=><option key={b.slug} value={b.slug}>{b.name} ({b.from_address})</option>)}
        </select>
      </div>
      <input type="email" placeholder="À *" value={f.to} onChange={e=>setF({...f,to:e.target.value})} required className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#D4AF37]" />
      <div className="grid grid-cols-2 gap-3">
        <input type="text" placeholder="Cc" value={f.cc} onChange={e=>setF({...f,cc:e.target.value})} className="bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input type="text" placeholder="Bcc" value={f.bcc} onChange={e=>setF({...f,bcc:e.target.value})} className="bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm" />
      </div>
      <input type="text" placeholder="Sujet *" value={f.subject} onChange={e=>setF({...f,subject:e.target.value})} required className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#D4AF37]" />
      {f.brand && templates.length>0 && (
        <select value={f.template} onChange={e=>setF({...f,template:e.target.value})} className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">— Template (optionnel) —</option>{templates.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
      )}
      <button type="button" onClick={()=>setF({...f,useHtml:!f.useHtml})} className={`px-3 py-1 rounded-lg text-xs font-medium ${f.useHtml?"bg-[#D4AF37] text-black":"bg-gray-800 text-gray-400"}`}>{f.useHtml?"HTML":"Texte"}</button>
      {f.useHtml?(
        <textarea placeholder="<html>..." value={f.html} onChange={e=>setF({...f,html:e.target.value})} rows={8} className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono" />
      ):(
        <textarea placeholder="Contenu..." value={f.text} onChange={e=>setF({...f,text:e.target.value})} rows={8} className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm" />
      )}
      <input type="text" placeholder="Idempotency-Key (auto si vide)" value={f.idempotencyKey} onChange={e=>setF({...f,idempotencyKey:e.target.value})} className="w-full bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono" />
      <button type="submit" disabled={sending} className="flex items-center gap-2 px-4 py-2 bg-[#D4AF37] text-black rounded-lg font-medium text-sm hover:bg-[#C49B2F] disabled:opacity-50">
        {sending?<Loader2 size={16} className="animate-spin" />:<Send size={16} />} Envoyer
      </button>
      {result && (
        <div className={`rounded-lg p-4 text-sm ${result.success?"bg-green-950/30 border border-green-800 text-green-300":"bg-red-950/30 border border-red-800 text-red-300"}`}>
          {result.success?(
            <div className="space-y-1"><div className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} /> Email envoyé</div>
            {result.message_id&&<div className="text-xs text-gray-400">messageId: {result.message_id.substring(0,16)}...</div>}
            <div className="text-xs text-gray-400">Statut: {result.status}</div></div>
          ):<div className="flex items-center gap-2"><XCircle size={16} /> {result.error}</div>}
        </div>
      )}
    </form>
  );
}

function HistoryTab() {
  const [logs,setLogs]=useState([]); const [loading,setLoading]=useState(true);
  const [filters,setFilters]=useState({brand:"",status:"",search:"",limit:50,offset:0}); const [selected,setSelected]=useState(null);
  const fetchLogs=useCallback(async()=>{setLoading(true);
    try{const p=new URLSearchParams();if(filters.brand)p.set("brand",filters.brand);if(filters.status)p.set("status",filters.status);if(filters.search)p.set("search",filters.search);p.set("limit",filters.limit);p.set("offset",filters.offset);
      const d=await apiFetch(`/api/emails/logs?${p}`);setLogs(Array.isArray(d)?d:d.logs||[]);
    }catch{setLogs([]);}setLoading(false);
  },[filters]);
  useEffect(()=>{fetchLogs();},[fetchLogs]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Recherche..." value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value,offset:0})} className="bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-48" />
        <select value={filters.brand} onChange={e=>setFilters({...filters,brand:e.target.value,offset:0})} className="bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
          <option value="">Toutes marques</option>
          <option value="js-innov-ia">JS-Innov.IA</option><option value="hainoflow">HainoFlow</option>
          <option value="facturapro">FacturaPro</option><option value="assurances-dour">Assurances Dour</option>
          <option value="ville-connect-os">VilleConnectOS</option><option value="synergie-dour">Synergie Dour</option>
          <option value="jytrix-ai">JYTRIX AI</option>
        </select>
        <select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value,offset:0})} className="bg-[#0F172A] border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
          <option value="">Tous statuts</option><option value="sent">Sent</option><option value="failed">Failed</option>
          <option value="pending">Pending</option><option value="dead_letter">Dead Letter</option><option value="cancelled">Cancelled</option>
        </select>
        <button onClick={fetchLogs} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg text-sm hover:bg-gray-700"><RefreshCw size={14} /> Actualiser</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead><tr className="bg-[#0F172A] text-gray-400 border-b border-gray-800">
            <th className="text-left px-3 py-2 font-medium">Date</th><th className="text-left px-3 py-2 font-medium">De</th>
            <th className="text-left px-3 py-2 font-medium">À</th><th className="text-left px-3 py-2 font-medium">Sujet</th>
            <th className="text-left px-3 py-2 font-medium">Marque</th><th className="text-left px-3 py-2 font-medium">Statut</th>
          </tr></thead>
          <tbody>
            {loading?<tr><td colSpan={6} className="text-center py-8 text-gray-500">Chargement...</td></tr>
            :logs.length===0?<tr><td colSpan={6} className="text-center py-8 text-gray-500">Aucun email</td></tr>
            :logs.map(l=>(
              <tr key={l.id} onClick={()=>setSelected(l)} className="border-b border-gray-800/50 hover:bg-gray-900/50 cursor-pointer">
                <td className="px-3 py-2 text-gray-400 text-xs">{fmtDate(l.created_at)}</td>
                <td className="px-3 py-2 text-gray-300 truncate max-w-[120px]">{l.from_address||"—"}</td>
                <td className="px-3 py-2 text-gray-300 truncate max-w-[150px]">{l.to_address||"—"}</td>
                <td className="px-3 py-2 text-gray-200 truncate max-w-[200px]">{l.subject||"—"}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{l.brand||"—"}</td>
                <td className="px-3 py-2"><StatusPill status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={()=>setSelected(null)}>
          <div className="bg-[#0F172A] border border-gray-700 rounded-xl max-w-lg w-full p-6 space-y-3" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-[#D4AF37]">Détail</h3><button onClick={()=>setSelected(null)}><X size={18} className="text-gray-400" /></button></div>
            <div className="space-y-1 text-sm">
              {[["Statut",<StatusPill status={selected.status} />],["Marque",selected.brand],["Application",selected.application],["De",selected.from_address],["À",selected.to_address],["Sujet",selected.subject],["Template",selected.template||"—"],["Créé",fmtDate(selected.created_at)],["Envoyé",fmtDate(selected.sent_at)],["Tentatives",String(selected.retry_count||0)]].map(([k,v])=>(
                <div key={k} className="flex gap-2 py-0.5"><span className="text-gray-500 min-w-[120px]">{k}</span><span className="text-gray-200 break-all">{v}</span></div>
              ))}
              {selected.error_message&&<div className="flex gap-2 py-0.5"><span className="text-gray-500 min-w-[120px]">Erreur</span><span className="text-red-400 break-all">{selected.error_message}</span></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueTab() {
  const [queue,setQueue]=useState([]); const [loading,setLoading]=useState(true);
  const fetchQ=useCallback(async()=>{setLoading(true);try{const s=await apiFetch("/api/emails/logs?status=sending&limit=50");const r=await apiFetch("/api/emails/logs?status=retry&limit=50");const p=await apiFetch("/api/emails/logs?status=pending&limit=50");setQueue([...s,...r,...p]);}catch{setQueue([]);}setLoading(false);},[]);
  useEffect(()=>{fetchQ();const i=setInterval(fetchQ,30000);return()=>clearInterval(i);},[fetchQ]);
  const retry=async(id)=>{try{await apiFetch(`/api/emails/${id}/retry`,{method:"POST"});fetchQ();}catch{}};
  const cancel=async(id)=>{try{await apiFetch(`/api/emails/${id}/cancel`,{method:"POST"});fetchQ();}catch{}};
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><span className="text-sm text-gray-400">Auto-refresh 30s — {queue.length} en attente</span>
        <button onClick={fetchQ} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg text-sm hover:bg-gray-700"><RefreshCw size={14} /> Actualiser</button></div>
      <div className="overflow-x-auto rounded-lg border border-gray-800"><table className="w-full text-sm">
        <thead><tr className="bg-[#0F172A] text-gray-400 border-b border-gray-800"><th className="text-left px-3 py-2 font-medium">Date</th><th className="text-left px-3 py-2 font-medium">Sujet</th><th className="text-left px-3 py-2 font-medium">Marque</th><th className="text-left px-3 py-2 font-medium">Statut</th><th className="text-left px-3 py-2 font-medium">Tent.</th><th className="text-left px-3 py-2 font-medium">Actions</th></tr></thead>
        <tbody>{loading?<tr><td colSpan={6} className="text-center py-8 text-gray-500">Chargement...</td></tr>:queue.length===0?<tr><td colSpan={6} className="text-center py-8 text-gray-500">File vide</td></tr>:queue.map(i=>(
          <tr key={i.id} className="border-b border-gray-800/50">
            <td className="px-3 py-2 text-gray-400 text-xs">{timeAgo(i.created_at)}</td><td className="px-3 py-2 text-gray-200 truncate max-w-[200px]">{i.subject}</td>
            <td className="px-3 py-2 text-gray-400 text-xs">{i.brand}</td><td className="px-3 py-2"><StatusPill status={i.status} /></td><td className="px-3 py-2 text-gray-400">{i.retry_count||0}</td>
            <td className="px-3 py-2"><div className="flex gap-1"><button onClick={()=>retry(i.id)} className="p-1 hover:bg-gray-800 rounded"><RefreshCw size={14} className="text-blue-400" /></button><button onClick={()=>cancel(i.id)} className="p-1 hover:bg-gray-800 rounded"><X size={14} className="text-red-400" /></button></div></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

function ErrorsTab() {
  const [errors,setErrors]=useState([]); const [loading,setLoading]=useState(true);
  const fetchE=useCallback(async()=>{setLoading(true);try{const f=await apiFetch("/api/emails/logs?status=failed&limit=50");const d=await apiFetch("/api/emails/logs?status=dead_letter&limit=50");setErrors([...d,...f]);}catch{setErrors([]);}setLoading(false);},[]);
  useEffect(()=>{fetchE();},[fetchE]);
  const retry=async(id)=>{try{await apiFetch(`/api/emails/${id}/retry`,{method:"POST"});fetchE();}catch{}};
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><span className="text-sm text-gray-400">{errors.length} erreurs</span><button onClick={fetchE} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg text-sm hover:bg-gray-700"><RefreshCw size={14} /> Actualiser</button></div>
      <div className="overflow-x-auto rounded-lg border border-gray-800"><table className="w-full text-sm">
        <thead><tr className="bg-[#0F172A] text-gray-400 border-b border-gray-800"><th className="text-left px-3 py-2 font-medium">Date</th><th className="text-left px-3 py-2 font-medium">Sujet</th><th className="text-left px-3 py-2 font-medium">Marque</th><th className="text-left px-3 py-2 font-medium">Erreur</th><th className="text-left px-3 py-2 font-medium">Tent.</th><th className="text-left px-3 py-2 font-medium">Action</th></tr></thead>
        <tbody>{loading?<tr><td colSpan={6} className="text-center py-8 text-gray-500">Chargement...</td></tr>:errors.length===0?<tr><td colSpan={6} className="text-center py-8 text-gray-500">Aucune erreur 🎉</td></tr>:errors.map(i=>(
          <tr key={i.id} className={`border-b border-gray-800/50 ${i.status==="dead_letter"?"bg-red-950/10":""}`}>
            <td className="px-3 py-2 text-gray-400 text-xs">{timeAgo(i.created_at)}</td><td className="px-3 py-2 text-gray-200 truncate max-w-[150px]">{i.subject}</td><td className="px-3 py-2 text-gray-400 text-xs">{i.brand}</td>
            <td className="px-3 py-2 text-red-400 text-xs truncate max-w-[200px]">{i.error_message||"—"}</td><td className="px-3 py-2 text-gray-400">{i.retry_count||0}</td>
            <td className="px-3 py-2"><button onClick={()=>retry(i.id)} className="flex items-center gap-1 px-2 py-1 bg-blue-900/30 text-blue-300 rounded text-xs hover:bg-blue-900/50"><RefreshCw size={12} /> Retry</button></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

function StatsTab() {
  const [stats,setStats]=useState(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{apiFetch("/api/emails/stats").then(setStats).catch(()=>setStats(null)).finally(()=>setLoading(false));},[]);
  if(loading)return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" /></div>;
  if(!stats)return <div className="text-center py-12 text-gray-500">Statistiques indisponibles</div>;
  const total=stats.total_sent||0,success=stats.total_success||0,failed=stats.total_failed||0,rate=total>0?Math.round((success/total)*100):0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Total (7j)",total,"#D4AF37"],["Succès",success,"#10b981"],["Échecs",failed,"#ef4444"],["Taux",`${rate}%`,"#3b82f6"]].map(([l,v,c])=>(
          <div key={l} className="bg-[#0F172A] border border-gray-800 rounded-lg p-4"><p className="text-xs text-gray-500 mb-1">{l}</p><p className="text-2xl font-bold" style={{color:c}}>{v}</p></div>
        ))}
      </div>
      {stats.by_brand&&Object.keys(stats.by_brand).length>0&&(
        <div><h3 className="text-sm font-medium text-gray-400 mb-2">Par marque</h3><div className="space-y-1">
          {Object.entries(stats.by_brand).map(([b,c])=>(<div key={b} className="flex items-center justify-between bg-[#0F172A] rounded-lg px-3 py-2"><span className="text-sm text-gray-300">{b}</span><span className="text-sm text-[#D4AF37] font-medium">{c}</span></div>))}
        </div></div>
      )}
      {stats.by_application&&Object.keys(stats.by_application).length>0&&(
        <div><h3 className="text-sm font-medium text-gray-400 mb-2">Par application</h3><div className="space-y-1">
          {Object.entries(stats.by_application).map(([a,c])=>(<div key={a} className="flex items-center justify-between bg-[#0F172A] rounded-lg px-3 py-2"><span className="text-sm text-gray-300">{a}</span><span className="text-sm text-[#D4AF37] font-medium">{c}</span></div>))}
        </div></div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates,setTemplates]=useState([]); const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false); const [editing,setEditing]=useState(null);
  const [f,setF]=useState({brand:"",name:"",subject:"",body_html:"",body_text:""});
  const fetchT=useCallback(async()=>{setLoading(true);try{setTemplates(await apiFetch("/api/emails/templates"));}catch{setTemplates([]);}setLoading(false);},[]);
  useEffect(()=>{fetchT();},[fetchT]);
  const submit=async(e)=>{e.preventDefault();try{if(editing){await apiFetch(`/api/emails/templates/${editing.id}`,{method:"PUT",body:JSON.stringify(f)});}else{await apiFetch("/api/emails/templates",{method:"POST",body:JSON.stringify(f)});}setShowForm(false);setEditing(null);fetchT();}catch{}};
  const del=async(id)=>{try{await apiFetch(`/api/emails/templates/${id}`,{method:"DELETE"});fetchT();}catch{}};
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center"><span className="text-sm text-gray-400">{templates.length} templates</span>
        <button onClick={()=>{setShowForm(true);setEditing(null);setF({brand:"",name:"",subject:"",body_html:"",body_text:""});}} className="flex items-center gap-1 px-3 py-1.5 bg-[#D4AF37] text-black rounded-lg text-sm font-medium hover:bg-[#C49B2F]"><Plus size={14} /> Nouveau</button></div>
      {showForm&&(
        <form onSubmit={submit} className="bg-[#0F172A] border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3"><input placeholder="Marque (slug)" value={f.brand} onChange={e=>setF({...f,brand:e.target.value})} required className="bg-[#0B0B0F] border border-gray-700 rounded-lg px-3 py-2 text-sm" /><input placeholder="Nom" value={f.name} onChange={e=>setF({...f,name:e.target.value})} required className="bg-[#0B0B0F] border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
          <input placeholder="Sujet ({{variables}})" value={f.subject} onChange={e=>setF({...f,subject:e.target.value})} className="w-full bg-[#0B0B0F] border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <textarea placeholder="HTML body" value={f.body_html} onChange={e=>setF({...f,body_html:e.target.value})} rows={4} className="w-full bg-[#0B0B0F] border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono" />
          <textarea placeholder="Text body" value={f.body_text} onChange={e=>setF({...f,body_text:e.target.value})} rows={4} className="w-full bg-[#0B0B0F] border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2"><button type="submit" className="px-4 py-2 bg-[#D4AF37] text-black rounded-lg text-sm font-medium">{editing?"Modifier":"Créer"}</button><button type="button" onClick={()=>setShowForm(false)} className="px-4 py-2 bg-gray-800 rounded-lg text-sm">Annuler</button></div>
        </form>
      )}
      <div className="space-y-1">{loading?<div className="text-center py-8 text-gray-500">Chargement...</div>:templates.length===0?<div className="text-center py-8 text-gray-500">Aucun template</div>:templates.map(t=>(
        <div key={t.id} className="flex items-center justify-between bg-[#0F172A] rounded-lg px-3 py-2">
          <div><span className="text-sm text-gray-200 font-medium">{t.name}</span><span className="text-xs text-gray-500 ml-2">{t.brand}</span></div>
          <div className="flex gap-1"><button onClick={()=>{setEditing(t);setShowForm(true);setF({brand:t.brand,name:t.name,subject:t.subject||"",body_html:t.body_html||"",body_text:t.body_text||""});}} className="p-1 hover:bg-gray-800 rounded"><Edit size={14} className="text-gray-400" /></button><button onClick={()=>del(t.id)} className="p-1 hover:bg-gray-800 rounded"><Trash2 size={14} className="text-red-400" /></button></div>
        </div>))}</div>
    </div>
  );
}

function SettingsTab() {
  const [brands,setBrands]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{apiFetch("/api/emails/brands").then(setBrands).catch(()=>setBrands([])).finally(()=>setLoading(false));},[]);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-400">Marques configurées</h3>
      {loading?<div className="text-center py-8 text-gray-500">Chargement...</div>:
        <div className="grid gap-2">{brands.map(b=>(
          <div key={b.slug} className="flex items-center gap-3 bg-[#0F172A] border border-gray-800 rounded-lg p-3">
            <div className="w-3 h-3 rounded-full" style={{background:b.brand_color||"#D4AF37"}} />
            <div className="flex-1"><div className="text-sm text-gray-200 font-medium">{b.name}</div><div className="text-xs text-gray-500">{b.from_address} · {b.domain||"—"}</div></div>
            <StatusPill status={b.active?"sent":"cancelled"} />
          </div>))}</div>}
      <p className="text-xs text-gray-600 mt-4">Configuration read-only. Les marques sont gérées via la table Brand en base. Ajouter une marque = INSERT, aucun code à modifier.</p>
    </div>
  );
}

// === INTEGRATION ===
// Dans App.jsx: import EmailCore from "@/pages/EmailCore";
// <Route path="/emails-core" element={<PageBoundary><EmailCore /></PageBoundary>} />
// Dans src/lib/roles.js: ajouter "/emails-core" aux routes admin et superadmin
// Dans Sidebar.jsx (groupe Communication): { label: "Email Core", icon: Send, path: "/emails-core", minRole: "admin" }
