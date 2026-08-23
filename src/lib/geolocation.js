// ============================================================
// geolocation.js — Géolocalisation Cockpit JS-Innov.IA
// Détecte et stocke la position de l'utilisateur
// ============================================================

// ─── Vérifier le support géolocalisation ──────────────────────
export function isGeolocationSupported() {
  return 'geolocation' in navigator;
}

// ─── Obtenir la position actuelle ─────────────────────────────
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(new Error('Géolocalisation non supportée'));
      return;
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
      ...options,
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        timestamp: pos.timestamp,
      }),
      (err) => reject(err),
      defaultOptions
    );
  });
}

// ─── Surveiller la position en continu ────────────────────────
export function watchPosition(onUpdate, onError, options = {}) {
  if (!isGeolocationSupported()) {
    onError(new Error('Géolocalisation non supportée'));
    return null;
  }

  return navigator.geolocation.watchPosition(
    (pos) => onUpdate({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      heading: pos.coords.heading,
      timestamp: pos.timestamp,
    }),
    onError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
      ...options,
    }
  );
}

// ─── Arrêter la surveillance ──────────────────────────────────
export function stopWatching(watchId) {
  if (watchId !== null && watchId !== undefined) {
    navigator.geolocation.clearWatch(watchId);
  }
}

// ─── Calculer distance entre 2 points (Haversine) ─────────────
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Envoyer la position au serveur ───────────────────────────
export async function sendLocationToServer(position) {
  try {
    await fetch('/api/push/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(position),
    });
    return true;
  } catch (e) {
    console.error('[geo] Erreur envoi position:', e.message);
    return false;
  }
}

// ─── Initialiser la géolocalisation + tracking ─────────────────
export async function initGeolocation(onUpdate) {
  if (!isGeolocationSupported()) {
    return { supported: false, watchId: null };
  }

  try {
    const pos = await getCurrentPosition();
    await sendLocationToServer(pos);
    if (onUpdate) onUpdate(pos);

    const watchId = watchPosition(async (newPos) => {
      await sendLocationToServer(newPos);
      if (onUpdate) onUpdate(newPos);
    });

    return { supported: true, watchId, initialPosition: pos };
  } catch (e) {
    console.warn('[geo] Position initiale échouée:', e.message);
    return { supported: true, watchId: null, error: e.message };
  }
}
