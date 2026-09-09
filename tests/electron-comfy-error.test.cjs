const test = require('node:test');
const assert = require('node:assert/strict');
const { formatComfyErrorBody } = require('../electron/comfy-error.cjs');

test('formate les erreurs ComfyUI structurées sans produire [object Object]', () => {
  const message = formatComfyErrorBody({
    error: {
      type: 'invalid_prompt',
      message: 'Cannot execute because node LoadImage is invalid',
      details: 'image not found',
      extra_info: { node_id: '12' },
    },
    node_errors: { '12': { class_type: 'LoadImage', errors: ['image not found'] } },
  });

  assert.match(message, /Cannot execute because node LoadImage is invalid/);
  assert.match(message, /type=invalid_prompt/);
  assert.match(message, /image not found/);
  assert.match(message, /node_errors/);
  assert.doesNotMatch(message, /\[object Object\]/);
});

test('conserve un message texte et sérialise le corps inconnu', () => {
  assert.equal(formatComfyErrorBody('ComfyUI arrêté'), 'ComfyUI arrêté');
  assert.equal(formatComfyErrorBody({ code: 'bad_workflow', node: 7 }), '{"code":"bad_workflow","node":7}');
});
