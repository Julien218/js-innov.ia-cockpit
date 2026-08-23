// ============================================================
// push-notifications.js — Gestionnaire notifications push
// Cockpit JS-Innov.IA
// ============================================================

const VAPID_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEu_TahDnaefqGbwbRDNlN-JA_cyapkcvLduSGtuBdHZMuMuy2wRgEpLzS-QNfiBMzM8yY7NE5UqVyHgRNyEkYAQ';

// ─── Conversion base64url → Uint8Array pour VAPID ────────────
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64_ = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64_);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr;
}

// ─── Enregistrer le service worker ────────────────────────────
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[push] Service Worker non supporté');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[push] SW enregistré:', reg.scope);
    return reg;
  } catch (e) {
    console.error('[push] Erreur SW:', e.message);
    return null;
  }
}

// ─── Demander permission notifications ────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const perm = await Notification.requestPermission();
  return perm; // 'granted' | 'denied' | 'default'
}

// ─── S'abonner aux push notifications ──────────────────────────
export async function subscribeToPush() {
  const reg = await registerServiceWorker();
  if (!reg) return null;

  const perm = await requestNotificationPermission();
  if (perm !== 'granted') {
    console.warn('[push] Permission refusée:', perm);
    return null;
  }

  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      console.log('[push] Abonnement existant:', existing.endpoint);
      return existing;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Envoyer l'abonnement au serveur
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(sub),
    });

    console.log('[push] Abonnement créé et envoyé au serveur');
    return sub;
  } catch (e) {
    console.error('[push] Erreur abonnement:', e.message);
    return null;
  }
}

// ─── Se désabonner ────────────────────────────────────────────
export async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      console.log('[push] Désabonné');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[push] Erreur désabonnement:', e.message);
    return false;
  }
}

// ─── Vérifier le statut d'abonnement ──────────────────────────
export async function getPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, subscribed: false };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return {
      supported: true,
      subscribed: !!sub,
      permission: Notification.permission,
    };
  } catch {
    return { supported: true, subscribed: false, permission: 'default' };
  }
}
