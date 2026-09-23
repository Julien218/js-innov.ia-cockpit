// ============================================================
// MobileHub.jsx — Hub mobile optimisé: géolocalisation + push
// Cockpit JS-Innov.IA
// ============================================================

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  BellOff,
  Bot,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LocateFixed,
  MapPin,
  MessageSquare,
  RefreshCw,
  Send,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react';
import {
  subscribeToPush,
  unsubscribeFromPush,
  getPushSubscriptionStatus,
} from '@/lib/push-notifications';
import {
  isGeolocationSupported,
  getCurrentPosition,
  watchPosition,
  stopWatching,
  sendLocationToServer,
} from '@/lib/geolocation';

const QUICK_ACTIONS = [
  { label: 'Dashboard', url: '/', icon: LayoutDashboard },
  { label: 'Clients', url: '/clients', icon: Users },
  { label: 'Tâches', url: '/taches', icon: CheckSquare },
  { label: 'Factures', url: '/factures', icon: FileText },
  { label: 'Demandes', url: '/demandes', icon: MessageSquare },
  { label: 'Agent IA', url: '/agent', icon: Bot },
];

function statusPill(ok, text, neutral = false) {
  const tone = neutral
    ? 'border-slate-400/20 bg-slate-500/10 text-slate-600'
    : ok
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
      : 'border-red-500/20 bg-red-500/10 text-red-600';
  return <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{text}</span>;
}

export default function MobileHub() {
  const [pushStatus, setPushStatus] = useState({ supported: false, subscribed: false, permission: 'default' });
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [watchId, setWatchId] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [permission, setPermission] = useState('default');
  const [loading, setLoading] = useState(false);
  const [notifPreview, setNotifPreview] = useState(null);
  const [serverPushStatus, setServerPushStatus] = useState(null);

  useEffect(() => {
    loadPushStatus();
    loadServerStatus();
  }, []);

  const loadPushStatus = async () => {
    const status = await getPushSubscriptionStatus();
    setPushStatus(status);
    setPermission(status.permission || 'default');
  };

  const loadServerStatus = async () => {
    try {
      const resp = await fetch('/api/push/status', { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        setServerPushStatus(data);
        if (data.location) setLocation(data.location);
      }
    } catch (e) {
      console.warn('[mobile-hub] Erreur statut serveur:', e.message);
    }
  };

  const handleEnablePush = async () => {
    setLoading(true);
    const sub = await subscribeToPush();
    if (sub) {
      setPushStatus(current => ({ ...current, subscribed: true }));
      setPermission('granted');
    }
    setLoading(false);
  };

  const handleDisablePush = async () => {
    setLoading(true);
    const ok = await unsubscribeFromPush();
    if (ok) {
      setPushStatus(current => ({ ...current, subscribed: false }));
    }
    setLoading(false);
  };

  const handleTestNotification = async () => {
    if (permission === 'granted') {
      new Notification('Cockpit JS-Innov.IA', {
        body: '✅ Notifications push opérationnelles',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'test',
      });
    }

    try {
      const resp = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: 'Cockpit JS-Innov.IA',
          body: '✅ Test de notification push',
          url: '/',
        }),
      });
      const data = await resp.json();
      setNotifPreview(data);
    } catch (e) {
      setNotifPreview({ error: e.message });
    }
  };

  const handleGetLocation = async () => {
    if (!isGeolocationSupported()) {
      setLocationError('Géolocalisation non supportée sur cet appareil');
      return;
    }
    setLoading(true);
    setLocationError(null);
    try {
      const pos = await getCurrentPosition();
      setLocation(pos);
      await sendLocationToServer(pos);
    } catch (e) {
      setLocationError(e.message);
    }
    setLoading(false);
  };

  const handleToggleTracking = () => {
    if (tracking) {
      stopWatching(watchId);
      setWatchId(null);
      setTracking(false);
      return;
    }

    const id = watchPosition(
      async (pos) => {
        setLocation(pos);
        await sendLocationToServer(pos);
      },
      (err) => setLocationError(err.message)
    );
    setWatchId(id);
    setTracking(true);
  };

  const pushActive = Boolean(serverPushStatus?.push_enabled);
  const geolocationReady = isGeolocationSupported();

  return (
    <div className="mobile-hub-page space-y-4 pb-4 text-foreground">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Smartphone className="h-4 w-4" />
            Mobile Hub
          </div>
          <h1 className="text-2xl font-bold">Mobilité & notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Géolocalisation, notifications push et accès rapides au Cockpit.</p>
        </div>
        <div className={`inline-flex w-fit items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${pushActive ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-red-500/20 bg-red-500/10 text-red-600'}`}>
          <span className={`h-2 w-2 rounded-full ${pushActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {pushActive ? 'Push actif' : 'Push inactif'}
        </div>
      </section>

      <section className="cockpit-float-panel cockpit-electric-frame p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="cockpit-icon-chip"><Bell className="h-4 w-4" /></span>
          <div>
            <h2 className="text-base font-semibold">Notifications Push</h2>
            <p className="text-xs text-muted-foreground">Gère l’abonnement de cet appareil et vérifie l’envoi.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {statusPill(pushStatus.supported, pushStatus.supported ? 'API Push supportée' : 'API Push non supportée')}
          {statusPill(pushStatus.subscribed, pushStatus.subscribed ? 'Abonné' : 'Non abonné', !pushStatus.subscribed)}
          {statusPill(permission === 'granted', `Permission : ${permission}`)}
        </div>

        <div className="flex flex-wrap gap-2">
          {!pushStatus.subscribed ? (
            <button type="button" onClick={handleEnablePush} disabled={loading} className="premium-button h-10 gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50">
              <Bell className="h-4 w-4" />
              {loading ? 'Activation…' : 'Activer les notifications'}
            </button>
          ) : (
            <button type="button" onClick={handleDisablePush} disabled={loading} className="workspace-secondary-action border-red-500/25 text-red-600 disabled:cursor-not-allowed disabled:opacity-50">
              <BellOff className="h-4 w-4" />
              Désactiver
            </button>
          )}
          <button type="button" onClick={handleTestNotification} disabled={!pushStatus.subscribed} className="workspace-secondary-action disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-4 w-4" />
            Tester
          </button>
        </div>

        {notifPreview && (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${notifPreview.error ? 'border-red-500/20 bg-red-500/10 text-red-600' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700'}`}>
            {notifPreview.error ? `❌ ${notifPreview.error}` : `✅ ${notifPreview.message || 'Envoyé'}`}
            {notifPreview.sent ? ` (${notifPreview.sent} appareil(s))` : ''}
          </div>
        )}
      </section>

      <section className="cockpit-float-panel cockpit-electric-frame p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="cockpit-icon-chip"><MapPin className="h-4 w-4" /></span>
          <div>
            <h2 className="text-base font-semibold">Géolocalisation</h2>
            <p className="text-xs text-muted-foreground">Position ponctuelle ou suivi continu selon les autorisations de l’appareil.</p>
          </div>
        </div>

        <div className="mb-4">
          {statusPill(geolocationReady, geolocationReady ? 'GPS disponible' : 'GPS non supporté')}
        </div>

        {location && (
          <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-300/10 p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">Latitude</p>
                <p className="mt-1 text-sm font-semibold text-amber-700">{location.latitude?.toFixed(6)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Longitude</p>
                <p className="mt-1 text-sm font-semibold text-amber-700">{location.longitude?.toFixed(6)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Précision</p>
                <p className="mt-1 text-sm font-medium">±{location.accuracy?.toFixed(0)} m</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Mise à jour</p>
                <p className="mt-1 text-sm font-medium">{new Date(location.timestamp || location.updated_at).toLocaleTimeString('fr-BE')}</p>
              </div>
            </div>
          </div>
        )}

        {locationError && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600">
            {locationError}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleGetLocation} disabled={loading || !geolocationReady} className="premium-button h-10 gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            <LocateFixed className="h-4 w-4" />
            {loading ? 'Localisation…' : 'Localiser'}
          </button>
          <button type="button" onClick={handleToggleTracking} disabled={!geolocationReady} className={`workspace-secondary-action disabled:cursor-not-allowed disabled:opacity-40 ${tracking ? 'border-red-500/25 text-red-600' : ''}`}>
            <RefreshCw className={`h-4 w-4 ${tracking ? 'animate-spin [animation-duration:2.8s]' : ''}`} />
            {tracking ? 'Arrêter le suivi' : 'Suivi continu'}
          </button>
        </div>
      </section>

      <section className="cockpit-float-panel cockpit-electric-frame p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="cockpit-icon-chip"><Zap className="h-4 w-4" /></span>
          <div>
            <h2 className="text-base font-semibold">Actions rapides</h2>
            <p className="text-xs text-muted-foreground">Accès sans rechargement pour conserver le player et l’état du Cockpit.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {QUICK_ACTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.url} to={item.url} className="cockpit-float-tile flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center text-sm font-medium text-foreground transition hover:-translate-y-0.5">
                <span className="cockpit-icon-chip"><Icon className="h-4 w-4" /></span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="cockpit-float-panel px-4 py-3 text-center">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Cockpit JS-Innov.IA — PWA v2.0 · Android & iOS · Notifications push · Géolocalisation
          {serverPushStatus?.subscribed ? ' · Push abonné' : ''}
          {location ? ' · Appareil localisé' : ''}
        </p>
      </section>
    </div>
  );
}
