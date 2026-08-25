const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverProposedAction, sanitizeAction } = require('../server-assistant.cjs');

const admin = { role: 'admin', organisation: 'jsinnovia' };

test('la confirmation Proximedia conserve le titre annoncé avant create_task', () => {
  const raw = { type: 'create_task', payload: { description: 'Créer une vidéo de 8 secondes.', priorite: 'haute' } };
  const recovered = recoverProposedAction(raw, {
    response: '- **Titre** : Création vidéo Proximedia - Écran géant Espace C à Dour\n- **Priorité** : Haute',
  });
  const action = sanitizeAction(recovered, admin);
  assert.equal(action.payload.titre, 'Création vidéo Proximedia - Écran géant Espace C à Dour');
  assert.equal(action.payload.statut, 'a_faire');
});

test('une tâche sans aucun titre est rejetée avant Supabase', () => {
  assert.equal(sanitizeAction({ type: 'create_task', payload: { description: 'Sans titre' } }, admin), null);
});

test('le média actif est automatiquement rattaché à la génération vidéo', () => {
  const raw = {
    type: 'create_video_generation',
    payload: {
      provider: 'auto', client_name: 'Proximedia', campaign_name: 'Écran géant Espace C',
      prompt: 'Animation premium fluide en 16:9 avec lisibilité maximale pour écran LED extérieur.',
    },
  };
  const recovered = recoverProposedAction(raw, {}, { documentId: '0a8370a0-0e2d-41b9-a5ea-6cd8446e54af' });
  const action = sanitizeAction(recovered, admin);
  assert.equal(action.payload.source_document_id, '0a8370a0-0e2d-41b9-a5ea-6cd8446e54af');
  assert.equal(action.definition.clientAction, '/api/video-generation/jobs');
});

test('NOVA peut rattacher le média actif à un client réel du Cockpit', () => {
  const recovered = recoverProposedAction({
    type: 'assign_media_client',
    payload: { clientId: 'client-proxiled-01', clientName: 'Proxiled' },
  }, {}, { documentId: '0a8370a0-0e2d-41b9-a5ea-6cd8446e54af' });
  const action = sanitizeAction(recovered, admin);
  assert.equal(action.id, '0a8370a0-0e2d-41b9-a5ea-6cd8446e54af');
  assert.equal(action.payload.clientId, 'client-proxiled-01');
  assert.equal(action.definition.clientMethod, 'PATCH');
  assert.equal(action.definition.clientAction, '/api/documents/portfolio-assets/:id/client');
});

test('NOVA refuse un rattachement média sans client vérifiable', () => {
  assert.equal(sanitizeAction({
    type: 'assign_media_client', id: 'media-01', payload: { clientName: 'Inconnu' },
  }, admin), null);
});
