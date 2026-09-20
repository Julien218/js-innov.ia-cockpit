const express = require('express');

const router = express.Router();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_ZONE = 'Dour, Belgique';
const DEFAULT_RADIUS_M = 12000;
const MAX_RADIUS_M = 25000;
const MAX_RESULTS = 80;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_MS = 3000;
const cache = new Map();
const lastSearchByActor = new Map();

const SECTORS = Object.freeze({
  all: {
    label: 'Tous secteurs commerciaux',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["shop"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["amenity"~"restaurant|cafe|fast_food|bar|pub|cinema|theatre|nightclub"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["leisure"~"fitness_centre|sports_centre"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["office"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["craft"];',
    ],
  },
  horeca: {
    label: 'Horeca',
    clauses: ['nwr(around:RADIUS,LAT,LON)["name"]["amenity"~"restaurant|cafe|fast_food|bar|pub|nightclub"];'],
  },
  retail: {
    label: 'Commerces',
    clauses: ['nwr(around:RADIUS,LAT,LON)["name"]["shop"];'],
  },
  beauty: {
    label: 'Beauté & bien-être',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["shop"~"beauty|hairdresser|cosmetics|massage"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["leisure"="fitness_centre"];',
    ],
  },
  auto: {
    label: 'Automobile',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["shop"~"car|car_repair|tyres|motorcycle"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["amenity"~"fuel|car_wash|car_rental"];',
    ],
  },
  health: {
    label: 'Santé',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["amenity"~"pharmacy|clinic|doctors|dentist|veterinary"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["healthcare"];',
    ],
  },
  services: {
    label: 'Services & professions',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["office"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["craft"];',
    ],
  },
  leisure: {
    label: 'Loisirs & sport',
    clauses: [
      'nwr(around:RADIUS,LAT,LON)["name"]["leisure"~"fitness_centre|sports_centre"];',
      'nwr(around:RADIUS,LAT,LON)["name"]["amenity"~"cinema|theatre"];',
    ],
  },
});

function clean(value, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalize(value) {
  return clean(value, 500)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function clampRadius(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RADIUS_M;
  return Math.max(1000, Math.min(MAX_RADIUS_M, Math.round(parsed)));
}

function contactValue(tags = {}, ...keys) {
  for (const key of keys) {
    const value = clean(tags[key], 300);
    if (value) return value;
  }
  return '';
}

function typeLabel(tags = {}) {
  const raw = tags.shop || tags.amenity || tags.office || tags.craft || tags.leisure || tags.healthcare || '';
  return clean(String(raw).replace(/_/g, ' '), 120);
}

function addressLabel(tags = {}) {
  const street = clean(tags['addr:street']);
  const house = clean(tags['addr:housenumber']);
  const postcode = clean(tags['addr:postcode']);
  const city = clean(tags['addr:city'] || tags['addr:place']);
  return [
    [street, house].filter(Boolean).join(' '),
    [postcode, city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

function candidateScore(tags = {}) {
  let score = 45;
  if (tags.website || tags['contact:website']) score += 12;
  if (tags.phone || tags['contact:phone']) score += 12;
  if (tags.email || tags['contact:email']) score += 12;
  if (tags.shop) score += 8;
  if (/restaurant|cafe|bar|pub|cinema|theatre|nightclub/.test(String(tags.amenity || ''))) score += 8;
  if (tags.brand) score += 3;
  return Math.min(100, score);
}

function elementCenter(element = {}) {
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

function toCandidate(element = {}) {
  const tags = element.tags || {};
  const name = clean(tags.name, 180);
  if (!name) return null;
  const center = elementCenter(element);
  return {
    id: `osm:${element.type || 'element'}:${element.id}`,
    osm_type: element.type || null,
    osm_id: element.id || null,
    name,
    category: typeLabel(tags) || 'commerce',
    address: addressLabel(tags),
    phone: contactValue(tags, 'contact:phone', 'phone'),
    email: contactValue(tags, 'contact:email', 'email'),
    website: contactValue(tags, 'contact:website', 'website'),
    facebook: contactValue(tags, 'contact:facebook', 'facebook'),
    lat: center.lat,
    lon: center.lon,
    score: candidateScore(tags),
    source: 'openstreetmap',
  };
}

function dedupeCandidates(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item?.name) continue;
    const key = [
      normalize(item.name),
      normalize(item.address),
      normalize(item.phone),
      normalize(item.website),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function geocodeZone(zone, fetchImpl = global.fetch) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', zone);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'be');
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'fr-BE,fr;q=0.9',
      'User-Agent': 'JS-Innov.IA-Cockpit/1.0 (https://jsinnovia.com/)',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`geocoding_http_${response.status}`);
  const data = await response.json();
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) throw new Error('zone_not_found');
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('zone_coordinates_invalid');
  return {
    lat,
    lon,
    label: clean(first.display_name, 240) || zone,
  };
}

function overpassQuery({ lat, lon, radius, sector }) {
  const definition = SECTORS[sector] || SECTORS.all;
  const clauses = definition.clauses.map((clause) => clause
    .replaceAll('RADIUS', String(radius))
    .replaceAll('LAT', String(lat))
    .replaceAll('LON', String(lon)))
    .join('\n');
  return `[out:json][timeout:20];\n(\n${clauses}\n);\nout center tags 250;`;
}

async function searchOpenStreetMap({ lat, lon, radius, sector }, fetchImpl = global.fetch) {
  const query = overpassQuery({ lat, lon, radius, sector });
  const response = await fetchImpl(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
      'User-Agent': 'JS-Innov.IA-Cockpit/1.0 (https://jsinnovia.com/)',
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`overpass_http_${response.status}`);
  const data = await response.json();
  const candidates = dedupeCandidates((data.elements || []).map(toCandidate).filter(Boolean));
  return candidates
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
    .slice(0, MAX_RESULTS);
}

async function searchProspects({ zone = DEFAULT_ZONE, radius = DEFAULT_RADIUS_M, sector = 'all' } = {}, fetchImpl = global.fetch) {
  const cleanZone = clean(zone, 80) || DEFAULT_ZONE;
  const safeRadius = clampRadius(radius);
  const safeSector = Object.hasOwn(SECTORS, sector) ? sector : 'all';
  const cacheKey = `${normalize(cleanZone)}|${safeRadius}|${safeSector}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const center = await geocodeZone(cleanZone, fetchImpl);
  const candidates = await searchOpenStreetMap({
    lat: center.lat,
    lon: center.lon,
    radius: safeRadius,
    sector: safeSector,
  }, fetchImpl);

  const value = {
    ok: true,
    checked_at: new Date().toISOString(),
    zone: cleanZone,
    resolved_zone: center.label,
    center: { lat: center.lat, lon: center.lon },
    radius_m: safeRadius,
    sector: safeSector,
    sector_label: SECTORS[safeSector].label,
    count: candidates.length,
    candidates,
    source: {
      provider: 'OpenStreetMap / Overpass',
      live: true,
      note: 'Données © contributeurs OpenStreetMap. Les coordonnées et informations de contact dépendent des données publiques disponibles et doivent être vérifiées avant prise de contact.',
    },
  };

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

router.get('/search', async (req, res) => {
  const actor = clean(req.user?.id || req.ip || 'unknown', 120);
  const now = Date.now();
  const lastSearch = lastSearchByActor.get(actor) || 0;
  if (now - lastSearch < RATE_LIMIT_MS) {
    res.setHeader('Retry-After', String(Math.ceil((RATE_LIMIT_MS - (now - lastSearch)) / 1000)));
    return res.status(429).json({
      ok: false,
      error: 'prospecting_rate_limited',
      message: 'Patientez quelques secondes avant de relancer une recherche.',
    });
  }
  lastSearchByActor.set(actor, now);

  try {
    const result = await searchProspects({
      zone: req.query.zone,
      radius: req.query.radius,
      sector: req.query.sector,
    });
    res.json(result);
  } catch (error) {
    const code = String(error?.message || 'prospecting_unavailable');
    const status = code === 'zone_not_found' ? 404 : 502;
    res.status(status).json({
      ok: false,
      error: code,
      message: code === 'zone_not_found'
        ? 'Zone introuvable. Essayez par exemple « Dour, Belgique » ou « Mons, Belgique ».'
        : 'La recherche publique de commerces est momentanément indisponible.',
    });
  }
});

module.exports = {
  router,
  searchProspects,
  geocodeZone,
  searchOpenStreetMap,
  overpassQuery,
  dedupeCandidates,
  toCandidate,
  SECTORS,
  DEFAULT_ZONE,
  DEFAULT_RADIUS_M,
};
