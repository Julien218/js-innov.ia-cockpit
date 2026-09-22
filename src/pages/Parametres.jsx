import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, Bot, Globe, Key, Bell, Shield, Database, CheckCircle2, XCircle, AlertTriangle, RefreshCw, GitBranch, Rocket, LockKeyhole, Server, Smartphone, Mail, Activity, Wrench, Plus, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_SERVICES } from "@/config/platformServices";
import ElyneaVoiceSettings from "@/components/ElyneaVoiceSettings";

const TABS = [
  ["elynea", "Elynea", Bot],
  ["agents", "Agents IA", Bot], ["builder", "Sites & déploiements", Globe],
  ["api", "APIs & clés", Key], ["emails", "Boîtes e-mail", Mail], ["moteur", "Moteurs de données", Database],
  ["notifs", "Notifications", Bell], ["securite", "Sécurité", Shield],
];

function StatusBadge({ ok, okLabel = "Actif", pendingLabel = "À configurer" }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>{ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{ok ? okLabel : pendingLabel}</span>;
}

function SectionHeader({ title, description, action }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{description}</p></div>{action}</div>;
}

function AgentsSettings({ status }) {
  const agents = status?.agents || [];
  const active = agents.filter((agent) => agent.status === "active").length;
  return <div className="space-y-6">
    <SectionHeader title="Agents réellement enregistrés" description={`${active} agent(s) actif(s) dans le registre interne NOVA. Les clés fournisseurs restent dans Railway.`} action={<Button variant="outline" onClick={() => window.location.assign("/agents-ia")}><Bot className="mr-2 h-4 w-4" />Ouvrir le registre</Button>} />
    <div className="grid gap-3 lg:grid-cols-2">{agents.map((agent) => <div key={agent.key} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{agent.name}</p><p className="mt-1 text-xs text-slate-400">{agent.role || "Agent NOVA interne"}</p></div><StatusBadge ok={agent.status === "active"} pendingLabel="Inactif" /></div>{agent.domains?.length > 0 && <p className="mt-3 text-xs text-cyan-300">{agent.domains.join(" · ")}</p>}</div>)}</div>
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-slate-300"><LockKeyhole className="mr-2 inline h-4 w-4 text-cyan-300" />L’ajout d’un fournisseur IA nécessite sa variable secrète côté serveur. Aucun champ de clé n’est proposé dans l’application `.exe`.</div>
  </div>;
}

function BuilderSettings({ status }) {
  const builder = status?.builder || {};
  const officialRepositoryUrl = PLATFORM_SERVICES.publicSite.repositoryUrl;
  return <div className="space-y-6">
    <SectionHeader title="Sites, GitHub et Railway" description="Le Cockpit supervise les domaines et route les demandes vers NOVA Site Ops. L’éditeur visuel directement dans la page n’est pas installé." action={<Button onClick={() => window.location.assign("/domaines")} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"><Activity className="mr-2 h-4 w-4" />Superviser les domaines</Button>} />
    <div className="grid gap-3 sm:grid-cols-3">
      {[[Wrench, "NOVA Site Ops", builder.nova_site_ops], [GitBranch, "Écriture GitHub depuis le Cockpit", builder.github_write], [Rocket, "Déploiement Railway depuis le Cockpit", builder.railway_write]].map(([Icon, label, ok]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4"><Icon className="mb-3 h-5 w-5 text-cyan-300" /><p className="text-sm font-medium text-white">{label}</p><div className="mt-2"><StatusBadge ok={ok} /></div></div>)}
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-700"><div className="divide-y divide-slate-700 bg-slate-900/40">{(builder.sites || []).map((site) => <div key={site.domain} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-white">{site.domain}</p><p className="mt-1 text-xs text-slate-500">{site.hosting || "Hébergement à vérifier"}{site.repository ? ` · ${site.repository}` : " · dépôt manquant"}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => window.open(site.url, "_blank", "noopener,noreferrer")}><Globe className="mr-1.5 h-3.5 w-3.5" />Voir</Button>{site.repository_url && <Button size="sm" variant="outline" onClick={() => window.open(site.domain === PLATFORM_SERVICES.publicSite.domain ? officialRepositoryUrl : site.repository_url, "_blank", "noopener,noreferrer")}><GitBranch className="mr-1.5 h-3.5 w-3.5" />GitHub</Button>}</div></div>)}</div></div>
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-sm font-medium text-amber-300">Éditeur intégré : non installé</p><p className="mt-1 text-sm text-slate-400">Pour modifier réellement un site aujourd’hui, utilise NOVA avec confirmation ou ouvre son dépôt GitHub. Cette page ne prétend plus être un Builder live.</p></div>
  </div>;
}

function IntegrationsSettings({ status }) {
  const items = status?.integrations || [];
  return <div className="space-y-6">
    <SectionHeader title="Inventaire serveur des intégrations" description={`${items.filter((item) => item.configured).length}/${items.length} intégrations détectées. Seule leur présence est affichée : aucune valeur secrète ne quitte Railway.`} />
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-slate-300"><Key className="mr-2 inline h-4 w-4 text-yellow-300" />Pour ajouter ou remplacer une clé secrète, utilise les variables du service Railway `cockpit-v3`. L’application vérifie ensuite automatiquement son état.</div>
    <div className="overflow-hidden rounded-xl border border-slate-700"><div className="divide-y divide-slate-700 bg-slate-900/40">{items.map((item) => <div key={item.variable} className="grid gap-3 p-4 md:grid-cols-[1.2fr_1fr_2fr_auto] md:items-center"><div><p className="text-sm font-medium text-white">{item.service}</p>{item.required && <p className="mt-1 text-[11px] text-amber-300">Requis</p>}</div><code className="w-fit rounded bg-slate-800 px-2 py-1 text-xs text-cyan-300">{item.variable}</code><p className="text-xs text-slate-400">{item.description}</p><StatusBadge ok={item.configured} /></div>)}</div></div>
  </div>;
}

function DataSettings({ status }) {
  return <div className="space-y-6"><SectionHeader title="Moteurs de données" description="État réel des sources utilisées par le Cockpit, Nova et les fonctions métier." /><div className="grid gap-4 lg:grid-cols-2">{(status?.data_engines || []).map((engine) => <div key={engine.name} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"><div className="flex items-start justify-between gap-3"><Server className="h-5 w-5 text-violet-300" /><StatusBadge ok={engine.configured} /></div><h3 className="mt-4 font-medium text-white">{engine.name}</h3><p className="mt-1 text-sm text-slate-400">{engine.purpose}</p></div>)}</div><Button variant="outline" onClick={() => window.location.assign("/rangement")}><Database className="mr-2 h-4 w-4" />Voir l’architecture des données</Button></div>;
}

function NotificationsSettings({ status }) {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const permission = supported ? Notification.permission : "unsupported";
  const notifications = status?.notifications || {};
  return <div className="space-y-6"><SectionHeader title="Notifications" description="État du serveur push, de l’appareil courant et de la messagerie de notification." action={<Button onClick={() => window.location.assign("/mobile-hub")}><Smartphone className="mr-2 h-4 w-4" />Gérer cet appareil</Button>} /><div className="grid gap-4 md:grid-cols-3">{[[Bell, "Serveur Push", notifications.push_server, "Actif", "À configurer"], [Smartphone, "Appareil courant", supported && permission === "granted", "Autorisé", supported ? `Permission : ${permission}` : "Non supporté"], [Mail, "Notifications email", notifications.email, "Actif", "À configurer"]].map(([Icon, label, ok, yes, no]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"><Icon className="mb-3 h-5 w-5 text-yellow-300" /><p className="font-medium text-white">{label}</p><div className="mt-3"><StatusBadge ok={ok} okLabel={yes} pendingLabel={no} /></div></div>)}</div><p className="text-xs text-slate-500">Les permissions Push se demandent depuis « Gérer cet appareil », au moment où tu choisis de les activer.</p></div>;
}

function SecuritySettings({ status }) {
  const security = status?.security || {};
  const controls = [["Session authentifiée", security.authenticated], ["Permissions contrôlées côté serveur", security.permissions_server_side], ["Secrets conservés côté serveur", security.secrets_server_side], ["Confirmation avant modification DNS", security.dns_confirmation_required], ["Cloisonnement des organisations", security.tenant_isolation]];
  return <div className="space-y-6"><SectionHeader title="Sécurité" description={`Contrôles actifs pour la session courante${security.role ? ` · rôle ${security.role}` : ""}.`} /><div className="rounded-xl border border-slate-700 bg-slate-900/40">{controls.map(([label, ok]) => <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-700 px-4 py-3 last:border-b-0"><span className="text-sm text-slate-300">{label}</span>{ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <XCircle className="h-5 w-5 text-red-400" />}</div>)}</div><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => window.location.assign("/gouvernance")}><Shield className="mr-2 h-4 w-4" />Gouvernance et audit</Button><Button variant="outline" onClick={() => window.location.assign("/invitations")}><LockKeyhole className="mr-2 h-4 w-4" />Accès et invitations</Button></div></div>;
}

// ── Boîtes Google / Gmail ────────────────────────────────────────────────────
function GoogleMailSettings() {
  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [requirements, setRequirements] = useState({});
  const [redirectUri, setRedirectUri] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [accountResponse, logResponse, statusResponse] = await Promise.all([
        fetch('/api/google-mail/accounts', { credentials: 'same-origin' }),
        fetch('/api/google-mail/cleanup-log', { credentials: 'same-origin' }),
        fetch('/api/google-mail/status', { credentials: 'same-origin' }),
      ]);
      const accountData = await accountResponse.json();
      const logData = await logResponse.json();
      const statusData = await statusResponse.json();
      if (!accountData.success) throw new Error(accountData.error || 'Chargement impossible');
      setAccounts(accountData.accounts || []);
      setConfigured(Boolean(statusData.configured));
      setRequirements(statusData.requirements || {});
      setRedirectUri(statusData.redirect_uri || '');
      setLogs(logData.success ? (logData.logs || []) : []);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') setMessage({ type: 'success', text: 'Boîte Google connectée avec succès. Elle est maintenant disponible dans la messagerie du Cockpit.' });
    if (params.get('google_error')) setMessage({ type: 'error', text: `Google a refusé la connexion : ${params.get('google_error')}` });
    if (params.has('google') || params.has('google_error')) {
      params.delete('google'); params.delete('google_error');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  const connectGoogle = async () => {
    setBusy('connect-google');
    setMessage(null);
    try {
      const response = await fetch('/api/google-mail/status', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Vérification Google impossible');
      if (!data.configured) {
        const labels = { google_client_id: 'GOOGLE_CLIENT_ID', google_client_secret: 'GOOGLE_CLIENT_SECRET', encryption_key: 'GOOGLE_MAIL_ENCRYPTION_KEY', database: 'SUPABASE_SERVICE_ROLE_KEY' };
        const missing = Object.entries(data.requirements || {}).filter(([, ready]) => !ready).map(([key]) => labels[key] || key);
        setRequirements(data.requirements || {});
        setRedirectUri(data.redirect_uri || '');
        throw new Error(`Connexion Google incomplète côté serveur : ${missing.join(', ')}.`);
      }
      window.location.assign('/api/google-mail/connect?brand=js-innov-ia');
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
      setBusy(null);
    }
  };

  const update = async (account, patch) => {
    setBusy(account.id);
    try {
      const response = await fetch(`/api/google-mail/accounts/${account.id}`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Modification impossible');
      setAccounts((current) => current.map((item) => item.id === account.id ? data.account : item));
      setMessage({ type: 'success', text: 'Paramètres enregistrés.' });
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
    finally { setBusy(null); }
  };

  const scan = async (account) => {
    setBusy(account.id);
    try {
      const response = await fetch(`/api/google-mail/accounts/${account.id}/scan`, { method: 'POST', credentials: 'same-origin' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Tri impossible');
      setMessage({ type: 'success', text: `${data.result.trashed || 0} publicité(s) déplacée(s) vers la corbeille, ${data.result.protected || 0} message(s) protégé(s).` });
      await load();
    } catch (error) { setMessage({ type: 'error', text: error.message }); setBusy(null); }
  };

  const restore = async (log) => {
    setBusy(log.id);
    try {
      const response = await fetch(`/api/google-mail/cleanup-log/${log.id}/restore`, { method: 'POST', credentials: 'same-origin' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Restauration impossible');
      setMessage({ type: 'success', text: 'E-mail restauré dans Gmail.' });
      await load();
    } catch (error) { setMessage({ type: 'error', text: error.message }); setBusy(null); }
  };

  const disconnect = async (account) => {
    if (!window.confirm(`Déconnecter ${account.email} du Cockpit ? Le tri automatique sera arrêté.`)) return;
    setBusy(account.id);
    try {
      const response = await fetch(`/api/google-mail/accounts/${account.id}`, { method: 'DELETE', credentials: 'same-origin' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Déconnexion impossible');
      await load();
    } catch (error) { setMessage({ type: 'error', text: error.message }); setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Boîtes Google connectées</h3>
          <p className="text-sm text-slate-400">Ajoutez plusieurs comptes Gmail ou Google Workspace au Cockpit.</p>
        </div>
        <Button disabled={busy === 'connect-google'} onClick={connectGoogle} className="bg-yellow-500 hover:bg-yellow-400 text-black">
          {busy === 'connect-google' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Ajouter une boîte e-mail
        </Button>
      </div>

      {!configured && <div className="space-y-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-sm text-amber-100"><p><AlertTriangle className="w-4 h-4 inline mr-2" />La connexion démarrera dès que les éléments manquants ci-dessous seront actifs côté serveur.</p><div className="flex flex-wrap gap-2">{[['google_client_id', 'Client ID'], ['google_client_secret', 'Client secret'], ['encryption_key', 'Chiffrement'], ['database', 'Base sécurisée']].map(([key, label]) => <span key={key} className={`rounded-full border px-2.5 py-1 text-xs ${requirements[key] ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-200'}`}>{requirements[key] ? '✓' : '○'} {label}</span>)}</div>{redirectUri && <div><p className="text-xs text-slate-400">URI de redirection autorisée à enregistrer dans Google Cloud :</p><code className="mt-1 block break-all rounded bg-slate-950/60 px-3 py-2 text-xs text-cyan-300">{redirectUri}</code></div>}</div>}
      {message && <div className={`p-3 rounded-xl border text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>{message.text}</div>}
      {loading && <div className="py-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</div>}

      {!loading && accounts.length === 0 && <div className="p-6 text-center rounded-xl border border-dashed border-slate-700 text-slate-400"><Mail className="w-9 h-9 mx-auto mb-2 opacity-40" />Aucune boîte Google connectée.</div>}

      <div className="space-y-4">
        {accounts.map((account) => (
          <div key={account.id} className="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium text-white">{account.label || account.email}</p><p className="text-xs text-slate-400">{account.email} · Google · {account.active ? 'connectée' : 'déconnectée'}</p></div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy === account.id || !account.active || !account.auto_trash_promotions} onClick={() => scan(account)} className="border-slate-600"><RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy === account.id ? 'animate-spin' : ''}`} />Trier maintenant</Button>
                <Button size="sm" variant="ghost" disabled={busy === account.id || !account.active} onClick={() => disconnect(account)} className="text-red-400">Déconnecter</Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="text-xs text-slate-400">Signature / marque
                <select value={account.brand} onChange={(event) => update(account, { brand: event.target.value })} disabled={!account.active} className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"><option value="js-innov-ia">JS-Innov.IA</option><option value="assurances-dour">Assurances Dour</option></select>
              </label>
              <label className="text-xs text-slate-400">Conserver les promotions pendant
                <select value={account.promotion_retention_days} onChange={(event) => update(account, { promotion_retention_days: Number(event.target.value) })} disabled={!account.active} className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"><option value="1">1 jour</option><option value="2">2 jours</option><option value="7">7 jours</option><option value="14">14 jours</option><option value="30">30 jours</option></select>
              </label>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={account.auto_trash_promotions} disabled={!account.active || busy === account.id} onChange={(event) => update(account, { auto_trash_promotions: event.target.checked })} className="mt-1" />
              <span><strong className="text-sm text-white">Déplacer automatiquement les publicités vers la corbeille</strong><span className="block text-xs text-slate-400 mt-0.5">Action récupérable. NOVA protège les factures, devis, paiements, commandes, messages importants ou étoilés.</span></span>
            </label>
            <label className="block text-xs text-slate-400">Expéditeurs protégés (un e-mail ou domaine par ligne)
              <textarea defaultValue={(account.protected_senders || []).join('\n')} onBlur={(event) => update(account, { protected_senders: event.target.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean) })} disabled={!account.active} rows={2} className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="comptable@client.be&#10;@fournisseur.be" />
            </label>
            {account.last_error && <p className="text-xs text-red-300">Dernière erreur : {account.last_error}</p>}
          </div>
        ))}
      </div>

      {logs.length > 0 && <div className="space-y-2"><h4 className="font-medium text-white">Publicités récemment déplacées</h4>{logs.slice(0, 20).map((log) => <div key={log.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700"><div className="min-w-0"><p className="text-sm text-white truncate">{log.subject || '(sans objet)'}</p><p className="text-xs text-slate-500 truncate">{log.sender} · {new Date(log.acted_at).toLocaleString('fr-BE')}</p></div>{log.action === 'trashed' && !log.restored_at && <Button size="sm" variant="ghost" disabled={busy === log.id} onClick={() => restore(log)}><RotateCcw className="w-3.5 h-3.5 mr-1" />Restaurer</Button>}</div>)}</div>}
    </div>
  );
}

export default function Parametres() {
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const [activeTab, setActiveTab] = useState(TABS.some(([id]) => id === requestedTab) ? requestedTab : "elynea");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadStatus = useCallback(async () => { setLoading(true); setError(""); try { const response = await fetch("/api/settings/status", { credentials: "same-origin" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `Configuration HTTP ${response.status}`); setStatus(data); } catch (loadError) { setError(loadError.message || "Configuration indisponible"); } finally { setLoading(false); } }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  const content = useMemo(() => { if (loading) return <div className="flex min-h-56 items-center justify-center text-sm text-slate-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Lecture de la configuration serveur…</div>; if (error) return <div className="flex min-h-56 flex-col items-center justify-center text-center"><AlertTriangle className="mb-3 h-8 w-8 text-amber-300" /><p className="text-sm text-slate-300">{error}</p><Button className="mt-4" variant="outline" onClick={loadStatus}>Réessayer</Button></div>; if (activeTab === "elynea") return <ElyneaVoiceSettings />; if (activeTab === "agents") return <AgentsSettings status={status} />; if (activeTab === "builder") return <BuilderSettings status={status} />; if (activeTab === "api") return <IntegrationsSettings status={status} />; if (activeTab === "emails") return <GoogleMailSettings />; if (activeTab === "moteur") return <DataSettings status={status} />; if (activeTab === "notifs") return <NotificationsSettings status={status} />; return <SecuritySettings status={status} />; }, [activeTab, error, loadStatus, loading, status]);
  return <div className="space-y-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Settings className="h-6 w-6 text-yellow-400" />Paramètres</h1><p className="mt-1 text-sm text-slate-400">Configuration réelle de la plateforme JS-Innov.IA, contrôlée côté serveur.</p></div><Button variant="outline" onClick={loadStatus} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button></div><div className="flex gap-2 overflow-x-auto border-b border-slate-700">{TABS.map(([id, label, Icon]) => <button key={id} onClick={() => setActiveTab(id)} className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === id ? "border-yellow-400 bg-slate-800 text-yellow-300" : "border-transparent text-slate-400 hover:text-white"}`}><Icon className="h-4 w-4" />{label}</button>)}</div><div className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-6">{content}</div>{status?.checked_at && <p className="text-right text-[11px] text-slate-600">État serveur vérifié le {new Date(status.checked_at).toLocaleString("fr-BE")}</p>}</div>;
}
