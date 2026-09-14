import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCircle2, CircleAlert, HelpCircle, Loader2, Menu, MessageSquare, Search, Wrench } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePermissions } from '@/lib/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { allNavGroups } from './Sidebar';
import { searchNavigation } from '@/lib/navigation';

function notificationStorageKey(user) {
  const identity = user?.id || user?.email || 'anonymous';
  return `jsinnovia:notification-state:${identity}`;
}

function loadNotificationState(user) {
  const baseline = new Date().toISOString();
  if (typeof window === 'undefined') return { baseline, readIds: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(notificationStorageKey(user)) || 'null');
    if (parsed && typeof parsed === 'object') {
      return {
        baseline: typeof parsed.baseline === 'string' ? parsed.baseline : baseline,
        readIds: Array.isArray(parsed.readIds) ? parsed.readIds.filter(value => typeof value === 'string').slice(-500) : [],
      };
    }
  } catch {
    // Un état local corrompu ne doit jamais bloquer le Cockpit.
  }
  const initial = { baseline, readIds: [] };
  window.localStorage.setItem(notificationStorageKey(user), JSON.stringify(initial));
  return initial;
}

function saveNotificationState(user, state) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(notificationStorageKey(user), JSON.stringify({
    baseline: state.baseline,
    readIds: [...new Set(state.readIds)].slice(-500),
  }));
}

function formatNotificationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
}

function notificationTone(event) {
  if (event?.severity === 'critical') return {
    icon: CircleAlert,
    box: 'border-red-500/30 bg-red-500/10',
    iconBox: 'bg-red-500/15 text-red-600 dark:text-red-300',
  };
  if (event?.severity === 'warning') return {
    icon: CircleAlert,
    box: 'border-amber-500/30 bg-amber-500/10',
    iconBox: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  };
  if (event?.severity === 'success') return {
    icon: CheckCircle2,
    box: 'border-emerald-500/30 bg-emerald-500/10',
    iconBox: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  };
  return {
    icon: Bell,
    box: 'border-border bg-background',
    iconBox: 'bg-primary/10 text-primary',
  };
}

function incidentDomain(event) {
  if (event?.event_type !== 'site.down') return '';
  const title = String(event?.title || '');
  const match = title.match(/Incident critique\s*[—–-]\s*([^\s]+)$/i);
  return String(match?.[1] || '').trim().toLowerCase();
}

function publicRepairMessage(result) {
  if (result?.verified) return 'Réparation terminée et vérifiée.';
  if (['RUNNING', 'RETRYING'].includes(result?.operational_status)) return 'Réparation prise en charge par Elynea. Le contrôle continue automatiquement.';
  if (result?.operational_status === 'WAITING_AUTHORIZATION') return 'Une autorisation technique supplémentaire reste nécessaire.';
  if (result?.operational_status === 'WAITING_INPUT') return 'Elynea attend une information technique avant de poursuivre.';
  if (result?.operational_status === 'NO_EXECUTOR') return 'Diagnostic confirmé, mais aucun exécuteur automatique n’est actuellement raccordé pour cette correction.';
  return String(result?.message || result?.reason || 'Intervention lancée.').replace(/\bNOVA\b/gi, 'Elynea');
}

export default function TopBar({ onOpenMobileMenu }) {
  const { user } = useAuth();
  const { role, canAccess } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [notificationState, setNotificationState] = useState(() => loadNotificationState(user));
  const [repairState, setRepairState] = useState({});
  const results = searchNavigation(allNavGroups, query, {
    role, canAccess,
    insuranceAllowed: role === 'superadmin' || user?.email?.toLowerCase() === 'olivier.trevis@pv.be',
  });
  const canRepairDomains = role === 'admin' || role === 'superadmin';

  useEffect(() => {
    setSearchOpen(false);
    setQuery('');
    setNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setNotificationState(loadNotificationState(user));
  }, [user?.id, user?.email]);

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setNotificationLoading(true);
    try {
      const response = await fetch('/api/data/Notifications?limit=50', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Notifications indisponibles');
      setNotifications(Array.isArray(data.events) ? data.events : []);
      setNotificationError('');
    } catch (error) {
      setNotificationError(error.message || 'Notifications indisponibles');
    } finally {
      if (!silent) setNotificationLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    refreshNotifications();
    const timer = window.setInterval(() => refreshNotifications({ silent: true }), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications, user]);

  const unreadIds = useMemo(() => {
    const baseline = new Date(notificationState.baseline || 0).getTime();
    const read = new Set(notificationState.readIds);
    return notifications
      .filter(event => {
        const created = new Date(event.created_at || 0).getTime();
        return Number.isFinite(created) && created > baseline && !read.has(event.id);
      })
      .map(event => event.id);
  }, [notificationState, notifications]);

  const unreadSet = useMemo(() => new Set(unreadIds), [unreadIds]);

  function persistState(next) {
    setNotificationState(next);
    saveNotificationState(user, next);
  }

  function markNotificationRead(id) {
    if (!id || notificationState.readIds.includes(id)) return;
    persistState({
      ...notificationState,
      readIds: [...notificationState.readIds, id],
    });
  }

  function markAllNotificationsRead() {
    persistState({
      baseline: new Date().toISOString(),
      readIds: [...notificationState.readIds, ...notifications.map(event => event.id)],
    });
  }

  function openNotification(event) {
    markNotificationRead(event.id);
    setNotificationsOpen(false);
    if (event.url) navigate(event.url);
  }

  function toggleNotifications() {
    setNotificationsOpen(current => {
      const next = !current;
      if (next) refreshNotifications();
      return next;
    });
  }

  async function repairCriticalIncident(event) {
    const domain = incidentDomain(event);
    if (!domain || !canRepairDomains || repairState[event.id]?.loading) return;
    markNotificationRead(event.id);
    setRepairState(current => ({ ...current, [event.id]: { loading: true, message: 'Préparation de la réparation…', error: false } }));
    try {
      const prepareResponse = await fetch('/api/domain-ops/prepare-repair', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, kind: 'repair' }),
      });
      const prepared = await prepareResponse.json().catch(() => ({}));
      if (!prepareResponse.ok) throw new Error(prepared.error || `Préparation impossible (HTTP ${prepareResponse.status})`);
      if (!prepared?.confirmation?.token) throw new Error('Aucun jeton de réparation n’a été préparé.');

      const repairResponse = await fetch('/api/domain-ops/repair', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: prepared.confirmation.token }),
      });
      const result = await repairResponse.json().catch(() => ({}));
      if (!repairResponse.ok && !result?.operational_status) throw new Error(result.error || `Réparation impossible (HTTP ${repairResponse.status})`);
      setRepairState(current => ({
        ...current,
        [event.id]: {
          loading: false,
          message: publicRepairMessage(result),
          error: repairResponse.status >= 500 || result?.operational_status === 'TECHNICAL_ERROR',
          verified: Boolean(result?.verified),
        },
      }));
      window.setTimeout(() => refreshNotifications({ silent: true }), 1500);
    } catch (error) {
      setRepairState(current => ({ ...current, [event.id]: { loading: false, message: error.message || 'Réparation impossible.', error: true } }));
    }
  }

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <header className="h-14 border-b flex items-center justify-between px-3 sm:px-5 gap-2 sm:gap-4 sticky top-0 z-20 shrink-0 relative bg-background/95 backdrop-blur">
      <button onClick={onOpenMobileMenu} className="md:hidden p-2 rounded-xl" aria-label="Ouvrir le menu"><Menu className="w-5 h-5" /></button>
      <p className="hidden md:block text-xs text-muted-foreground capitalize">{today}</p>
      <div className="flex-1 max-w-md relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Rechercher une page" placeholder="Aller à une page…" value={query}
          aria-expanded={searchOpen} aria-controls="navigation-results" autoComplete="off"
          onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'Escape') setSearchOpen(false);
            if (event.key === 'Enter' && searchOpen && results[0]) { event.preventDefault(); navigate(results[0].path); setSearchOpen(false); }
          }} className="pl-9 h-9 text-xs rounded-xl" />
        {searchOpen && <nav id="navigation-results" aria-label="Résultats de recherche des pages" className="absolute top-full mt-2 left-0 right-0 max-h-[60vh] overflow-auto rounded-xl border bg-background shadow-xl p-2">
          <p className="px-2 py-1 text-xs text-muted-foreground">{query ? 'Pages accessibles' : 'Accès rapide · tapez le nom d’une page'}</p>
          {results.map(item => <Link key={item.path} to={item.path} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted focus-visible:bg-muted">
            <item.icon className="w-4 h-4 shrink-0" /><span className="text-sm">{item.label}<span className="block text-xs text-muted-foreground">{item.group}</span></span>
          </Link>)}
          {!results.length && <p role="status" className="p-2 text-sm">Aucune page accessible ne correspond à « {query} ».</p>}
        </nav>}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {canAccess('/demandes') && <Button asChild variant="ghost" size="icon" aria-label="Ouvrir les demandes" title="Demandes à traiter"><Link to="/demandes"><MessageSquare className="w-4 h-4" /></Link></Button>}
        <Button type="button" variant="ghost" size="icon" aria-label={unreadIds.length ? `${unreadIds.length} notifications non lues` : 'Ouvrir les notifications'} title="Notifications" onClick={toggleNotifications} className="relative">
          {unreadIds.length ? <BellRing className="w-4 h-4 text-primary" /> : <Bell className="w-4 h-4" />}
          {unreadIds.length > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">{Math.min(99, unreadIds.length)}</span>}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Aide à la navigation" title="Aide à la navigation" onClick={() => setHelpOpen(true)}><HelpCircle className="w-4 h-4" /></Button>
        <span title={user?.email} className="hidden sm:flex w-8 h-8 rounded-xl bg-primary/10 items-center justify-center text-primary text-xs font-bold">{user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'J'}</span>
      </div>

      {notificationsOpen && <section className="absolute right-3 sm:right-5 top-[calc(100%+.5rem)] z-50 w-[min(27rem,calc(100vw-1.5rem))] max-h-[min(38rem,calc(100dvh-5rem))] overflow-hidden rounded-2xl border bg-background shadow-2xl flex flex-col" aria-label="Centre de notifications">
        <div className="p-4 border-b flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground mt-0.5">{unreadIds.length ? `${unreadIds.length} nouvelle${unreadIds.length > 1 ? 's' : ''}` : 'Vous êtes à jour'}</p>
          </div>
          {unreadIds.length > 0 && <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={markAllNotificationsRead}>Tout marquer comme lu</Button>}
        </div>

        {notificationError && <div className="mx-3 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">{notificationError}</div>}

        <div className="overflow-y-auto p-3">
          {notificationLoading && notifications.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Chargement des notifications…</p> :
            notifications.length ? <div className="space-y-2">{notifications.map(event => {
              const tone = notificationTone(event);
              const Icon = tone.icon;
              const unread = unreadSet.has(event.id);
              const domain = incidentDomain(event);
              const repair = repairState[event.id];
              const showRepair = Boolean(domain && canRepairDomains && event.severity === 'critical');
              return <div key={event.id} className={`w-full rounded-xl border transition ${unread ? tone.box : 'border-border/70 bg-muted/20'}`}>
                <button type="button" onClick={() => openNotification(event)} className="w-full text-left p-3 transition hover:bg-muted/60 rounded-xl">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tone.iconBox}`}><Icon className="w-4 h-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold">{event.title || 'Information'}</span>
                        {unread && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                      </span>
                      <span className="block mt-1 text-xs text-muted-foreground leading-relaxed">{event.body || 'Une nouvelle activité concerne votre espace.'}</span>
                      <span className="block mt-1.5 text-[10px] text-muted-foreground">{formatNotificationDate(event.created_at)}</span>
                    </span>
                  </div>
                </button>
                {showRepair && <div className="px-3 pb-3 pl-[3.25rem]">
                  <button type="button" onClick={() => repairCriticalIncident(event)} disabled={repair?.loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                    {repair?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : repair?.verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
                    {repair?.loading ? 'Réparation en cours…' : repair?.verified ? 'Réparation vérifiée' : 'Réparer automatiquement'}
                  </button>
                  {repair?.message && <p className={`mt-1.5 text-[10px] leading-4 ${repair.error ? 'text-red-300' : repair.verified ? 'text-emerald-300' : 'text-muted-foreground'}`}>{repair.message}</p>}
                </div>}
              </div>;
            })}</div> :
              <div className="py-8 text-center">
                <Bell className="mx-auto w-7 h-7 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-medium">Aucune notification</p>
                <p className="mt-1 text-xs text-muted-foreground">Les nouvelles données et incidents de votre organisation apparaîtront ici.</p>
              </div>}
        </div>
      </section>}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Se repérer dans le Cockpit</DialogTitle><DialogDescription>Choisissez une page selon ce que vous voulez faire.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <p><strong>Rechercher une page :</strong> saisissez son nom, puis sélectionnez un résultat. Entrée ouvre le premier résultat ; Échap ferme la recherche.</p>
            <p><strong>Notifications :</strong> la cloche rassemble automatiquement les nouvelles données, mises à jour et incidents liés à votre organisation. Les administrateurs peuvent lancer une réparation automatique depuis un incident critique de site.</p>
            <p><strong>Suivre le travail :</strong> les Demandes rassemblent les besoins ; les Projets et les Tâches servent à suivre leur réalisation.</p>
            <p><strong>Créer et gérer :</strong> le Studio regroupe la production de contenus ; Finance contient les devis et les factures.</p>
            <p><strong>Lire les états :</strong> une autorisation requise, une information manquante et une erreur technique demandent des actions différentes. « Terminée avec preuve » indique un résultat documenté.</p>
            <p className="text-muted-foreground">La recherche porte sur les pages accessibles à votre compte, pas sur le contenu des documents. Sur mobile, ouvrez le menu en haut à gauche.</p>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
