const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const prospecting = require('../server-pilotyasign-prospecting.cjs');

test('PilotyaSign prospecting API is mounted behind collaborator permission', () => {
  const server = read('server.cjs');
  assert.match(server, /\/api\/pilotyasign-prospecting/);
  assert.match(server, /requireSession\('collaborateur'\)/);
  assert.match(server, /requirePermission\('pilotyasign_prospecting', 'collaborateur'\)/);
});

test('Overpass query is bounded and sector-specific', () => {
  const query = prospecting.overpassQuery({
    lat: 50.395,
    lon: 3.78,
    radius: 12000,
    sector: 'horeca',
  });
  assert.match(query, /amenity/);
  assert.match(query, /restaurant\|cafe\|fast_food\|bar\|pub\|nightclub/);
  assert.match(query, /around:12000,50\.395,3\.78/);
  assert.match(query, /out center tags 250/);
});

test('live prospect search geocodes then returns deduplicated scored candidates', async () => {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (String(input).includes('nominatim.openstreetmap.org/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{
          lat: '50.3950',
          lon: '3.7800',
          display_name: 'Dour, Mons, Hainaut, Belgique',
        }],
      };
    }
    if (String(input).includes('overpass-api.de/api/interpreter')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 50.40,
              lon: 3.79,
              tags: {
                name: 'Commerce Démo',
                shop: 'clothes',
                phone: '+32 65 00 00 00',
                website: 'https://example.test',
                'addr:street': 'Rue Grande',
                'addr:housenumber': '1',
                'addr:postcode': '7370',
                'addr:city': 'Dour',
              },
            },
            {
              type: 'node',
              id: 2,
              lat: 50.40,
              lon: 3.79,
              tags: {
                name: 'Commerce Démo',
                shop: 'clothes',
                phone: '+32 65 00 00 00',
                website: 'https://example.test',
                'addr:street': 'Rue Grande',
                'addr:housenumber': '1',
                'addr:postcode': '7370',
                'addr:city': 'Dour',
              },
            },
          ],
        }),
      };
    }
    throw new Error('unexpected_fetch');
  };

  const result = await prospecting.searchProspects({
    zone: 'Dour, Belgique test unique',
    radius: 12000,
    sector: 'retail',
  }, fetchMock);

  assert.equal(result.ok, true);
  assert.equal(result.radius_m, 12000);
  assert.equal(result.sector, 'retail');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, 'Commerce Démo');
  assert.equal(result.candidates[0].address, 'Rue Grande 1, 7370 Dour');
  assert.ok(result.candidates[0].score >= 60);
  assert.equal(calls.length, 2);
  assert.match(calls[1].init.body, /data=/);
});

test('PilotyaSign UI exposes Elynea discovery, anti-duplicate and CRM insertion', () => {
  const page = read('src/pages/PilotyaSign.jsx');
  assert.match(page, /Prospection assistée par Elynea/);
  assert.match(page, /\/api\/pilotyasign-prospecting\/search/);
  assert.match(page, /duplicateLeadFor/);
  assert.match(page, /Ajouter au pipeline/);
  assert.match(page, /base44\.entities\.Lead\.create/);
  assert.match(page, /© contributeurs OpenStreetMap/);
});
