const test = require('node:test');
const assert = require('node:assert/strict');
test('decorative Markdown, escaped stars and emoji are silent; useful numbers and accents stay', async () => {
  const { speechDecoration } = await import('../src/lib/speechDecoration.js');
  assert.equal(speechDecoration("'\n\n---\n\n🌟 \\*\\*'"), '');
  assert.equal(speechDecoration('🌟 **Bonjour Julien !**'), 'Bonjour Julien !');
  assert.equal(speechDecoration('Le total est 123,45 € ; échéance 24-09-2026.'), 'Le total est 123,45 € ; échéance 24-09-2026.');
  assert.equal(speechDecoration('[facture](https://example.test/f.pdf)'), 'facture');
});
