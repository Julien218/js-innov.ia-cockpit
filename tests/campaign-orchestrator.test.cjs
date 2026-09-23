const test = require('node:test');
const assert = require('node:assert/strict');
const { brandPrompt, normalizeBrand, normalizeDraft } = require('../server-campaigns-core.cjs');
const { allowedImageHost } = require('../server-campaigns.cjs');

const context = {
  brand: {
    name: 'Miss & Mister Dour',
    site_url: 'https://missetmisterdour.be',
    tone: 'élégant, humain',
    palette: { gold: '#D4AF37', night: '#0F172A' },
    visual_rules: { must: ['plume discrète'], avoid: ['kitsch'] },
    hashtags_required: ['#MissMisterDour', '#MissMisterDour2027'],
    hashtags_recommended: ['#Dour'],
    hashtags_forbidden: ['#FakePartner'],
    brand_board_url: null
  },
  campaign: { name: 'Recrutement 2027', objective: 'candidatures', phase: 'recrutement', cta: 'S’inscrire' },
  bible: { text: 'La plume reste un fil conducteur discret.', source: 'github', sha: 'abc123' }
};

test('brandPrompt injecte la Bible ADN et les interdits', () => {
  const prompt = brandPrompt(context, 'Créer un visuel recrutement', 'image');
  assert.match(prompt, /BIBLE ADN CANONIQUE/);
  assert.match(prompt, /plume discrète/);
  assert.match(prompt, /kitsch/);
  assert.match(prompt, /Recrutement 2027/);
});

test('normalizeDraft force les hashtags obligatoires et retire les interdits', () => {
  const draft = normalizeDraft({
    hashtags: { instagram: ['#Dour', '#FakePartner'], facebook: [], tiktok: ['#Casting'] },
    image_prompt: 'image', video_prompt: 'video'
  }, context);
  assert.deepEqual(draft.hashtags.instagram, ['#MissMisterDour', '#MissMisterDour2027', '#Dour']);
  assert.deepEqual(draft.hashtags.facebook, ['#MissMisterDour', '#MissMisterDour2027']);
  assert.equal(draft.hashtags.tiktok.includes('#Casting'), true);
});

test('normalizeBrand conserve la politique moteur par marque', () => {
  const brand = normalizeBrand({ name: 'X', slug: 'X', video_engine: 'local', fallback_to_api: true, hashtags_required: ['#X'] }, 'jsinnovia');
  assert.equal(brand.slug, 'x');
  assert.equal(brand.video_engine, 'local');
  assert.equal(brand.fallback_to_api, true);
});

test('proxy image refuse les hôtes arbitraires', () => {
  assert.equal(allowedImageHost('media.base44.com'), true);
  assert.equal(allowedImageHost('evil.example'), false);
});
