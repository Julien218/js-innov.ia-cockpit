const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyBrandSignature,
  assertMailboxMatchesBrand,
  identityForBrand,
  identityForMailbox,
} = require('../server-email-branding.cjs');

test('JS-Innov.IA utilise exclusivement son identité et sa signature', () => {
  const signed = applyBrandSignature({ text: 'Bonjour', html: '<p>Bonjour</p>', brand: 'jsinnovia' });
  assert.equal(signed.identity.address, 'info@jsinnovia.com');
  assert.match(signed.text, /Julien Pagin/);
  assert.match(signed.text, /JS-Innov\.IA/);
  assert.match(signed.html, /data-jsinnovia-signature="js-innov-ia"/);
  assert.doesNotMatch(signed.html, /Assurances-Dour/);
});

test('Assurances-Dour utilise ses coordonnées validées et jamais la signature JS-Innov.IA', () => {
  const signed = applyBrandSignature({ text: 'Bonjour', html: '<p>Bonjour</p>', brand: 'assurances-dour' });
  assert.equal(signed.identity.address, 'info@assurances-dour.be');
  assert.match(signed.text, /Grand-Place 9, 7370 Dour/);
  assert.match(signed.text, /0494 11 90 90/);
  assert.match(signed.html, /data-jsinnovia-signature="assurances-dour"/);
  assert.doesNotMatch(signed.html, /Julien Pagin/);
});

test('une signature existante ne peut pas être ajoutée deux fois', () => {
  const first = applyBrandSignature({ html: '<p>Message</p>', brand: 'js-innov-ia' });
  const second = applyBrandSignature({ html: first.html, brand: 'js-innov-ia' });
  assert.equal(second.html, first.html);
  assert.equal((second.html.match(/data-jsinnovia-signature/g) || []).length, 1);
});

test('le serveur refuse tout croisement entre boîte et marque', () => {
  assert.equal(assertMailboxMatchesBrand('jsinnovia', 'js-innov-ia').slug, 'js-innov-ia');
  assert.equal(assertMailboxMatchesBrand('store', 'js-innov-ia').slug, 'js-innov-ia');
  assert.equal(assertMailboxMatchesBrand('assurances', 'assurances-dour').slug, 'assurances-dour');
  assert.throws(() => assertMailboxMatchesBrand('assurances', 'js-innov-ia'), /Identité refusée/);
  assert.throws(() => assertMailboxMatchesBrand('jsinnovia', 'assurances-dour'), /Identité refusée/);
  assert.equal(identityForMailbox('assurances').slug, 'assurances-dour');
  assert.equal(identityForBrand('store').slug, 'js-innov-ia');
  assert.equal(identityForBrand('villeconnect').slug, 'js-innov-ia');
});

test('l’image Railway embarque le module de signature e-mail', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --from=builder \/app\/server-email-branding\.cjs \.\/server-email-branding\.cjs/);
});
