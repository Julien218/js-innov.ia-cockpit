const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.CLIENT_ALERT_CONTACT_SYNC_ENABLED = 'false';
const {
  normalizePhone,
  cleanTenant,
  buildDbConfig,
} = require('../assets/client-alert-contacts.cjs');

test('normalise les numéros belges existants vers E.164', () => {
  assert.equal(normalizePhone('0475/42.69.42'), '+32475426942');
  assert.equal(normalizePhone('0475426942'), '+32475426942');
  assert.equal(normalizePhone('0032475426942'), '+32475426942');
});

test('construit les contacts depuis une fiche client existante sans activer WhatsApp sans opt-in', () => {
  const config = buildDbConfig([{
    nom: 'Trevis',
    entreprise: 'STARLIGHT ASBL',
    telephone: '0475/42.69.42',
    statut: 'actif',
    alert_tenant_key: 'starlight-asbl',
    alert_phone: '0475/42.69.42',
    alert_sms_enabled: true,
    alert_whatsapp_enabled: true,
    alert_whatsapp_opt_in: false,
    alert_site_incidents: true,
    alert_screen_incidents: true,
  }]);

  assert.deepEqual(config['starlight-asbl'].sms, ['+32475426942']);
  assert.deepEqual(config['starlight-asbl'].whatsapp, []);
  assert.deepEqual(config['starlight-asbl'].alert_types, { site: true, screen: true });
});

test('préfère une fiche active et renseignée lorsqu’un client existe en double', () => {
  const config = buildDbConfig([
    { entreprise: 'Pixelium', statut: 'actif', alert_tenant_key: 'pixelium', alert_phone: null },
    { entreprise: 'Pixelium', statut: 'actif', alert_tenant_key: 'pixelium', alert_phone: '0475426942', alert_sms_enabled: true, alert_site_incidents: true },
  ]);
  assert.deepEqual(config.pixelium.sms, ['+32475426942']);
});

test('la clé organisation est stable', () => {
  assert.equal(cleanTenant('Synergie Dour ASBL'), 'synergie-dour-asbl');
});

test('la page Clients expose les réglages Contacts & Alertes et reprend le téléphone principal', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Clients.jsx'), 'utf8');
  assert.match(source, /Contacts & alertes · Téléphone SMS \/ WhatsApp/);
  assert.match(source, /alert_phone: source\.alert_phone \|\| source\.telephone \|\| ""/);
  assert.match(source, /alert_whatsapp_opt_in/);
  assert.match(source, /alert_site_incidents/);
  assert.match(source, /alert_screen_incidents/);
});
