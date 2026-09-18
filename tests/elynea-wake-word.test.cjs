const test = require('node:test');
const assert = require('node:assert/strict');

test('détecte Elynea et extrait la commande', async () => {
  const { extractElyneaWakeCommand } = await import('../src/lib/elyneaWakeWord.js');
  assert.deepEqual(extractElyneaWakeCommand('Elynea ouvre mes emails'), {
    detected: true,
    wakeWord: 'elynea',
    command: 'ouvre mes emails',
  });
});

test('accepte les variantes courantes de reconnaissance vocale', async () => {
  const { extractElyneaWakeCommand } = await import('../src/lib/elyneaWakeWord.js');
  assert.equal(extractElyneaWakeCommand('Elina').detected, true);
  assert.equal(extractElyneaWakeCommand('Elyna regarde mes tâches').detected, true);
});

test('ignore une phrase sans mot d’appel', async () => {
  const { extractElyneaWakeCommand } = await import('../src/lib/elyneaWakeWord.js');
  assert.equal(extractElyneaWakeCommand('ouvre mes emails').detected, false);
});

test('un appel seul ne fabrique pas de commande', async () => {
  const { extractElyneaWakeCommand } = await import('../src/lib/elyneaWakeWord.js');
  assert.deepEqual(extractElyneaWakeCommand('Elynea !'), {
    detected: true,
    wakeWord: 'elynea',
    command: '',
  });
});
