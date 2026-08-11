import React, { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, Film, Loader2, MessageCircle, Plus, Rocket, Send, Settings2, Sparkles } from 'lucide-react';
import { SOCIAL_AGENT_TEMPLATES, templateById } from '@/data/socialAgentTemplates';

const api = async (path, options = {}) => {
  const res = await fetch(`/api/social-agent${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

const statusLabel = {
  draft: 'Brouillon', research: 'Recherche', generating: 'Génération', review: 'À contrôler', pending_approval: 'Validation Olivier/client',
  approved: 'Validé', changes_requested: 'À modifier', rejected: 'Refusé', publishing: 'Publication', published: 'Publié', failed: 'Erreur',
};

export default function SocialContentAgent() {
  const [profiles, setProfiles] = useState([]);
  const [items, setItems] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [templateId, setTemplateId] = useState('local-media');
  const [profileForm, setProfileForm] = useState({ client_id: '', slug: '', display_name: '', approver_name: '', approver_phone: '' });
  const [contentForm, setContentForm] = useState({ editorial_series: '', topic: '', scheduled_for: '' });

  const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedProfileId) || null, [profiles, selectedProfileId]);

  const load = async () => {
    setError('');
    try {
      const [p, d] = await Promise.all([api('/profiles'), api('/dashboard')]);
      setProfiles(p.profiles || []);
      setDashboard(d);
      const id = selectedProfileId || p.profiles?.[0]?.id || '';
      setSelectedProfileId(id);
      if (id) {
        const c = await api(`/items?profile_id=${encodeURIComponent(id)}`);
        setItems(c.items || []);
      } else setItems([]);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!selectedProfileId) return;
    api(`/items?profile_id=${encodeURIComponent(selectedProfileId)}`).then(d => setItems(d.items || [])).catch(e => setError(e.message));
  }, [selectedProfileId]);

  const createProfile = async () => {
    const tpl = templateById(templateId);
    setBusy('profile'); setError('');
    try {
      const payload = {
        ...profileForm,
        vertical: tpl.vertical,
        brand_voice: tpl.brand_voice,
        editorial_rules: tpl.editorial_rules,
        weekly_schedule: tpl.weekly_schedule,
        channels: tpl.channels,
        require_human_approval: true,
        auto_publish_after_approval: true,
      };
      const d = await api('/profiles', { method: 'POST', body: JSON.stringify(payload) });
      setShowCreate(false);
      setProfileForm({ client_id: '', slug: '', display_name: '', approver_name: '', approver_phone: '' });
      await load();
      setSelectedProfileId(d.profile.id);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const createContent = async () => {
    if (!selectedProfileId || !contentForm.topic.trim()) return;
    setBusy('content'); setError('');
    try {
      const d = await api('/items', { method: 'POST', body: JSON.stringify({ profile_id: selectedProfileId, ...contentForm, scheduled_for: contentForm.scheduled_for || null }) });
      setItems(v => [d.item, ...v]);
      setContentForm({ editorial_series: '', topic: '', scheduled_for: '' });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const action = async (item, name) => {
    setBusy(`${item.id}:${name}`); setError('');
    try {
      await api(`/items/${item.id}/${name}`, { method: 'POST', body: '{}' });
      const d = await api(`/items?profile_id=${encodeURIComponent(selectedProfileId)}`);
      setItems(d.items || []);
      const db = await api('/dashboard'); setDashboard(db);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><Bot className="w-7 h-7 text-primary" /><h1 className="text-2xl font-bold">Agent Réseaux IA</h1></div>
          <p className="text-sm text-muted-foreground mt-1">Création → vidéo → validation WhatsApp → publication → statistiques, avec validation humaine obligatoire.</p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"><Plus className="w-4 h-4" /> Nouveau profil client</button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><CircleAlert className="w-4 h-4 mt-0.5" />{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Agents actifs" value={dashboard?.active_profiles || 0} />
        <Stat label="Contenus" value={dashboard?.content_total || 0} />
        <Stat label="Publiés" value={dashboard?.publications_total || 0} />
        <Stat label="En validation" value={dashboard?.status_counts?.pending_approval || 0} />
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2"><Settings2 className="w-5 h-5" /><h2 className="font-semibold">Créer un agent duplicable</h2></div>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Type de client"><select value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">{SOCIAL_AGENT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="ID client"><input value={profileForm.client_id} onChange={e => setProfileForm(v => ({ ...v, client_id: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="ex: olivier-trevis" /></Field>
            <Field label="Slug"><input value={profileForm.slug} onChange={e => setProfileForm(v => ({ ...v, slug: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="le-tour-de-dour" /></Field>
            <Field label="Nom affiché"><input value={profileForm.display_name} onChange={e => setProfileForm(v => ({ ...v, display_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="Le Tour de Dour" /></Field>
            <Field label="Validateur"><input value={profileForm.approver_name} onChange={e => setProfileForm(v => ({ ...v, approver_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="Olivier" /></Field>
            <Field label="WhatsApp validateur"><input value={profileForm.approver_phone} onChange={e => setProfileForm(v => ({ ...v, approver_phone: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="+32..." /></Field>
          </div>
          <div className="rounded-lg bg-muted p-3 text-sm"><strong>{templateById(templateId).name}</strong> — {templateById(templateId).description}</div>
          <button disabled={busy === 'profile'} onClick={createProfile} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">{busy === 'profile' ? 'Création…' : 'Créer l’agent client'}</button>
        </div>
      )}

      <div className="grid lg:grid-cols-[320px,1fr] gap-5">
        <div className="rounded-xl border bg-card p-4 h-fit">
          <h2 className="font-semibold mb-3">Profils clients</h2>
          <div className="space-y-2">
            {profiles.map(p => <button key={p.id} onClick={() => setSelectedProfileId(p.id)} className={`w-full text-left rounded-lg border p-3 ${selectedProfileId === p.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}><div className="font-medium text-sm">{p.display_name}</div><div className="text-xs text-muted-foreground">{p.vertical} · {(p.channels || []).map(c => typeof c === 'string' ? c : c.name).join(', ')}</div><div className="mt-2 text-xs flex items-center gap-1">{p.require_human_approval ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <CircleAlert className="w-3 h-3 text-amber-600" />} Validation humaine</div></button>)}
            {!profiles.length && <p className="text-sm text-muted-foreground">Aucun profil agent pour le moment.</p>}
          </div>
        </div>

        <div className="space-y-5">
          {selectedProfile && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 className="font-semibold">Créer un contenu — {selectedProfile.display_name}</h2><p className="text-xs text-muted-foreground">L’agent préparera le package éditorial puis la vidéo avant validation.</p></div><div className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">HITL obligatoire</div></div>
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Rubrique"><input value={contentForm.editorial_series} onChange={e => setContentForm(v => ({ ...v, editorial_series: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="LA RUÉE VERS DOUR" /></Field>
                <Field label="Sujet"><input value={contentForm.topic} onChange={e => setContentForm(v => ({ ...v, topic: e.target.value }))} className="w-full border rounded-lg px-3 py-2" placeholder="Rue Grande — origine du nom" /></Field>
                <Field label="Date prévue"><input type="datetime-local" value={contentForm.scheduled_for} onChange={e => setContentForm(v => ({ ...v, scheduled_for: e.target.value }))} className="w-full border rounded-lg px-3 py-2" /></Field>
              </div>
              <button disabled={busy === 'content'} onClick={createContent} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50"><Sparkles className="w-4 h-4" /> Ajouter au pipeline</button>
            </div>
          )}

          <div className="space-y-3">
            {items.map(item => <ContentCard key={item.id} item={item} busy={busy} onAction={action} />)}
            {selectedProfileId && !items.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucun contenu pour ce profil.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentCard({ item, busy, onAction }) {
  const wait = name => busy === `${item.id}:${name}`;
  return <div className="rounded-xl border bg-card p-4">
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
      <div><div className="flex items-center gap-2"><Film className="w-4 h-4 text-primary" /><h3 className="font-semibold">{item.editorial_series || 'Publication'}</h3></div><p className="text-sm mt-1">{item.topic}</p><p className="text-xs text-muted-foreground mt-1">Statut : {statusLabel[item.status] || item.status} · V{item.version}</p></div>
      {item.approval_code && <span className="text-[11px] font-mono rounded bg-muted px-2 py-1">{item.approval_code}</span>}
    </div>
    {item.caption && <div className="mt-3 text-sm rounded-lg bg-muted/60 p-3 whitespace-pre-wrap">{item.caption}</div>}
    {item.media_url && <video className="mt-3 w-full max-h-96 rounded-lg bg-black" src={item.media_url} controls preload="metadata" />}
    <div className="mt-4 flex flex-wrap gap-2">
      {['draft','changes_requested','failed'].includes(item.status) && <Action disabled={wait('generate')} onClick={() => onAction(item, 'generate')} icon={wait('generate') ? Loader2 : Sparkles}>{item.status === 'changes_requested' ? 'Créer V suivante' : 'Générer'}</Action>}
      {['review','changes_requested'].includes(item.status) && <Action disabled={wait('send-approval')} onClick={() => onAction(item, 'send-approval')} icon={MessageCircle}>Envoyer sur WhatsApp</Action>}
      {item.status === 'pending_approval' && <span className="inline-flex items-center gap-2 text-xs rounded-lg bg-amber-50 text-amber-800 px-3 py-2"><MessageCircle className="w-4 h-4" /> En attente du validateur</span>}
      {item.status === 'approved' && <span className="inline-flex items-center gap-2 text-xs rounded-lg bg-emerald-50 text-emerald-700 px-3 py-2"><CheckCircle2 className="w-4 h-4" /> Validé</span>}
      {item.status === 'published' && <span className="inline-flex items-center gap-2 text-xs rounded-lg bg-blue-50 text-blue-700 px-3 py-2"><Rocket className="w-4 h-4" /> Publié</span>}
      {['review','pending_approval'].includes(item.status) && <Action disabled={wait('approve')} onClick={() => onAction(item, 'approve')} icon={Send}>Validation manuelle cockpit</Action>}
    </div>
  </div>;
}

function Action({ icon: Icon, children, ...props }) { return <button {...props} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50"><Icon className={`w-4 h-4 ${Icon === Loader2 ? 'animate-spin' : ''}`} />{children}</button>; }
function Field({ label, children }) { return <label className="block"><span className="block text-xs font-medium text-muted-foreground mb-1">{label}</span>{children}</label>; }
function Stat({ label, value }) { return <div className="rounded-xl border bg-card p-4"><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>; }
