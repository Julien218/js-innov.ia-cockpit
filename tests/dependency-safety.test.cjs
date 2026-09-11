const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

test('Express query parser safely round-trips untrusted constructor keys', () => {
  const expressRequire = createRequire(require.resolve('express/package.json'));
  const qs = expressRequire('qs');
  const parsed = qs.parse('filter[constructor][isBuffer]=invalid', {plainObjects:true});
  assert.doesNotThrow(() => qs.stringify(parsed));
  assert.deepEqual(qs.parse('page=2&tags[]=video&tags[]=audio'), {page:'2', tags:['video','audio']});
});

test('updated mail transport preserves French content and recipients without SMTP delivery', async () => {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({jsonTransport:true});
  const result = await transport.sendMail({
    from:'cockpit@example.invalid', to:'test@example.invalid',
    subject:'Vérification du Cockpit', text:'Montage prêt, durée vérifiée.',
    disableFileAccess:true, disableUrlAccess:true
  });
  const message = JSON.parse(result.message);
  assert.equal(message.subject, 'Vérification du Cockpit');
  assert.equal(message.to[0].address, 'test@example.invalid');
  assert.equal(message.text, 'Montage prêt, durée vérifiée.');
});
