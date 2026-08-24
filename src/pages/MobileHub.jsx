// ============================================================
// MobileHub.jsx — Hub mobile optimisé: géolocalisation + push
// Cockpit JS-Innov.IA
// ============================================================

import { useState, useEffect } from 'react';
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

const COLORS = {
  bg: '#0a0a14',
  card: '#13131f',
  gold: '#D4AF37',
  cyan: '#06B6D4',
  violet: '#7C3AED',
  text: '#f5f5f5',
  muted: '#71717a',
  border: '#27272a',
  success: '#22c55e',
  danger: '#ef4444',
};

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

  // ─── Charger le statut au montage ──────────────────────────
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

  // ─── Activer notifications push ────────────────────────────
  const handleEnablePush = async () => {
    setLoading(true);
    const sub = await subscribeToPush();
    if (sub) {
      setPushStatus({ ...pushStatus, subscribed: true });
      setPermission('granted');
    }
    setLoading(false);
  };

  // ─── Désactiver notifications push ─────────────────────────
  const handleDisablePush = async () => {
    setLoading(true);
    const ok = await unsubscribeFromPush();
    if (ok) {
      setPushStatus({ ...pushStatus, subscribed: false });
    }
    setLoading(false);
  };

  // ─── Envoyer notification test ─────────────────────────────
  const handleTestNotification = async () => {
    // Local notification
    if (permission === 'granted') {
      new Notification('Cockpit JS-Innov.IA', {
        body: '✅ Notifications push opérationnelles',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'test',
      });
    }

    // Server push
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

  // ─── Obtenir position actuelle ─────────────────────────────
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

  // ─── Activer/désactiver le tracking continu ────────────────
  const handleToggleTracking = () => {
    if (tracking) {
      stopWatching(watchId);
      setWatchId(null);
      setTracking(false);
    } else {
      const id = watchPosition(
        async (pos) => {
          setLocation(pos);
          await sendLocationToServer(pos);
        },
        (err) => setLocationError(err.message)
      );
      setWatchId(id);
      setTracking(true);
    }
  };

  // ─── Style helpers ────────────────────────────────────────
  const cardStyle = {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
  };

  const buttonBase = {
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const buttonGold = { ...buttonBase, background: COLORS.gold, color: COLORS.bg };
  const buttonCyan = { ...buttonBase, background: COLORS.cyan, color: COLORS.bg };
  const buttonDanger = { ...buttonBase, background: 'transparent', color: COLORS.danger, border: `1px solid ${COLORS.danger}` };

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, padding: '16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
      {/* Header mobile safe-area */}
      <div style={{ paddingTop: 'env(safe-area-inset-top)', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>
          📱 Mobile Hub
        </h1>
        <p style={{ color: COLORS.muted, fontSize: '13px', marginTop: '4px' }}>
          Géolocalisation & Notifications push
        </p>
      </div>

      {/* ─── Statut global ─────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: COLORS.muted }}>Statut système</span>
          <span style={{ fontSize: '12px', color: serverPushStatus?.push_enabled ? COLORS.success : COLORS.danger }}>
            {serverPushStatus?.push_enabled ? '● Push actif' : '● Push inactif'}
          </span>
        </div>
      </div>

      {/* ─── Notifications Push ─────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '18px' }}>🔔</span>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Notifications Push</h2>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', background: pushStatus.supported ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: pushStatus.supported ? COLORS.success : COLORS.danger }}>
            {pushStatus.supported ? 'API Push supportée' : 'API Push non supportée'}
          </span>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', background: pushStatus.subscribed ? 'rgba(34,197,94,0.15)' : 'rgba(113,113,122,0.15)', color: pushStatus.subscribed ? COLORS.success : COLORS.muted }}>
            {pushStatus.subscribed ? 'Abonné' : 'Non abonné'}
          </span>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', background: permission === 'granted' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: permission === 'granted' ? COLORS.success : COLORS.danger }}>
            Permission: {permission}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!pushStatus.subscribed ? (
            <button onClick={handleEnablePush} disabled={loading} style={buttonGold}>
              {loading ? '...' : '🔔 Activer les notifications'}
            </button>
          ) : (
            <button onClick={handleDisablePush} disabled={loading} style={buttonDanger}>
              Désactiver
            </button>
          )}
          <button onClick={handleTestNotification} disabled={!pushStatus.subscribed} style={buttonCyan}>
            📨 Tester
          </button>
        </div>

        {notifPreview && (
          <div style={{ marginTop: '12px', padding: '8px', background: 'rgba(6,182,212,0.1)', borderRadius: '6px', fontSize: '12px' }}>
            {notifPreview.error ? `❌ ${notifPreview.error}` : `✅ ${notifPreview.message || 'Envoyé'}`}
            {notifPreview.sent && ` (${notifPreview.sent} appareil(s))`}
          </div>
        )}
      </div>

      {/* ─── Géolocalisation ───────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '18px' }}>📍</span>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Géolocalisation</h2>
        </div>

        <div style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', marginBottom: '12px', display: 'inline-block',
          background: isGeolocationSupported() ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: isGeolocationSupported() ? COLORS.success : COLORS.danger }}>
          {isGeolocationSupported() ? 'GPS disponible' : 'GPS non supporté'}
        </div>

        {location && (
          <div style={{ marginBottom: '12px', padding: '12px', background: 'rgba(212,175,55,0.08)', borderRadius: '8px', border: `1px solid ${COLORS.gold}40` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '11px', color: COLORS.muted }}>Latitude</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.gold }}>{location.latitude?.toFixed(6)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: COLORS.muted }}>Longitude</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.gold }}>{location.longitude?.toFixed(6)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: COLORS.muted }}>Précision</div>
                <div style={{ fontSize: '14px' }}>±{location.accuracy?.toFixed(0)}m</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: COLORS.muted }}>MAJ</div>
                <div style={{ fontSize: '14px' }}>{new Date(location.timestamp || location.updated_at).toLocaleTimeString('fr-BE')}</div>
              </div>
            </div>
          </div>
        )}

        {locationError && (
          <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', fontSize: '12px', color: COLORS.danger }}>
            ❌ {locationError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleGetLocation} disabled={loading || !isGeolocationSupported()} style={buttonGold}>
            {loading ? '...' : '📍 Localiser'}
          </button>
          <button onClick={handleToggleTracking} disabled={!isGeolocationSupported()} style={tracking ? buttonDanger : buttonCyan}>
            {tracking ? '⏹ Arrêter le suivi' : '🔄 Suivi continu'}
          </button>
        </div>
      </div>

      {/* ─── Actions rapides mobile ────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0' }}>⚡ Actions rapides</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            { label: 'Dashboard', url: '/', icon: '📊' },
            { label: 'Clients', url: '/clients', icon: '👥' },
            { label: 'Tâches', url: '/taches', icon: '✅' },
            { label: 'Factures', url: '/factures', icon: '📄' },
            { label: 'Demandes', url: '/demandes', icon: '📨' },
            { label: 'Agent IA', url: '/agent', icon: '🤖' },
          ].map((item) => (
            <a key={item.url} href={item.url} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              padding: '12px', borderRadius: '8px', background: COLORS.bg,
              border: `1px solid ${COLORS.border}`, textDecoration: 'none', color: COLORS.text,
              fontSize: '12px', transition: 'all 0.2s',
            }}>
              <span style={{ fontSize: '24px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ─── Info PWA ──────────────────────────────────────── */}
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <p style={{ fontSize: '11px', color: COLORS.muted, margin: 0 }}>
          Cockpit JS-Innov.IA — PWA v2.0<br />
          Installable sur Android & iOS · Notifications push · Géolocalisation<br />
          {serverPushStatus?.subscribed && '🔔 Abonné aux push'} {location && '· 📍 Localisé'}
        </p>
      </div>
    </div>
  );
}
