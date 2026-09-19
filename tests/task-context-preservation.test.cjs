const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichTaskBatchWithRequestContext,
  pickRelevantTask,
  missingVideoFields,
  taskContextBlock,
  videoEnvironmentContext,
  guardTaskAwareAssistantResponse,
} = require('../server-task-context.cjs');

test('le batch conserve la cible web de la demande source', () => {
  const payload = enrichTaskBatchWithRequestContext({ tasks: [{ titre: 'Vérifier la nouvelle page', description: 'Contrôler son accessibilité.' }] }, 'https://www.letourdedour.com/');
  assert.match(payload.tasks[0].description, /Demande source: https:\/\/www\.letourdedour\.com\//);
});

test('le batch conserve la référence Cockpit et le chemin du média', () => {
  const payload = enrichTaskBatchWithRequestContext({ tasks: [{ titre: "Analyser l'application des caméras" }] }, 'Analyse cette image', {
    fileName: 'Img 4136.png',
    documentId: 'doc-camera-1',
    dropboxPath: '/Cockpit/A_Classer/Images/Img 4136.png',
  });
  const description = payload.tasks[0].description;
  assert.match(description, /Index Cockpit: doc-camera-1/);
  assert.match(description, /Chemin Dropbox: \/Cockpit\/A_Classer\/Images\/Img 4136\.png/);
});

test('les blocs internes injectés ne sont pas recopiés dans les tâches', () => {
  const payload = enrichTaskBatchWithRequestContext({ tasks: [{ titre: 'Contrôle' }] }, 'Contrôle le site\n[AUTORISATION COCKPIT — ACTION NON SENSIBLE]\ntexte interne\n[/AUTORISATION COCKPIT]');
  assert.doesNotMatch(payload.tasks[0].description, /texte interne|AUTORISATION COCKPIT/);
  assert.match(payload.tasks[0].description, /Demande source: Contrôle le site/);
});


test('Elynea retrouve la tâche existante à partir de son titre et ignore le doublon historique', () => {
  const canonical = {
    id: 'task-video-3d',
    titre: 'Création de vidéo cinématographique 3D',
    statut: 'en_cours',
    organisation_id: 'jsinnovia',
    description: 'Créer une scène cinématographique 3D premium sur la piste DOUR SPORT au coucher du soleil.',
    notes: 'Résultat reçu mais non finalisé: generation_video_incomplete:source_document_id',
  };
  const duplicate = {
    ...canonical,
    id: 'task-video-3d-old',
    statut: 'bloquee',
    notes: 'Audit NOVA: doublon bloqué sans suppression; tâche canonique task-video-3d (exact_duplicate).',
  };
  const selected = pickRelevantTask([duplicate, canonical], 'Création de vidéo cinématographique 3D', 'jsinnovia');
  assert.equal(selected.id, 'task-video-3d');
});

test('le contexte vidéo détecte uniquement la source réellement manquante et conserve le scénario connu', () => {
  const task = {
    id: 'task-video-3d',
    titre: 'Création de vidéo cinématographique 3D',
    statut: 'en_cours',
    description: 'Créer une image finale cinématographique 3D premium, chaleureuse, lumineuse et héroïque sur la piste DOUR SPORT au coucher du soleil.',
    notes: [
      'Résultat reçu mais non finalisé: generation_video_incomplete:client_id,source_document_id',
      'Résultat reçu mais non finalisé: generation_video_incomplete:source_document_id',
    ].join('\n'),
  };
  assert.deepEqual(missingVideoFields(task), ['source_document_id']);
  const block = taskContextBlock(task, [task]);
  assert.match(block, /DOUR SPORT/);
  assert.match(block, /champs techniques encore manquants détectés: source_document_id/);

  const environment = videoEnvironmentContext({
    task,
    availableActions: ['create_video_generation'],
    localEnvironment: { recently_reachable: true, last_autopilot_success_at: '2026-09-19T16:00:00.000Z' },
  });
  assert.match(environment, /8 secondes/);
  assert.match(environment, /16:9/);
  assert.match(environment, /MP4/);
  assert.match(environment, /Grok Imagine\/xAI/);
  assert.match(environment, /demander uniquement quelle image existante utiliser/i);
});

test('le garde-fou remplace le questionnaire générique par la seule information réellement requise', () => {
  const task = {
    id: 'task-video-3d',
    titre: 'Création de vidéo cinématographique 3D',
    description: 'Canari victorieux avec coupe dorée sur la piste DOUR SPORT au coucher du soleil.',
    notes: 'Résultat reçu mais non finalisé: generation_video_incomplete:source_document_id',
  };
  const generic = [
    '1. Scénario : quel est le thème ?',
    '2. Durée : quelle durée ?',
    '3. Style : quel style ?',
    '4. Ressources 3D : disposez-vous de modèles 3D ?',
    '5. Formats de sortie : MP4 ?',
  ].join('\n');

  const answer = guardTaskAwareAssistantResponse(generic, {
    task,
    availableActions: ['create_video_generation'],
  });
  assert.match(answer, /J’ai retrouvé la tâche/);
  assert.match(answer, /DOUR SPORT/);
  assert.match(answer, /8 s, 16:9/);
  assert.match(answer, /seul élément encore manquant.*image source/i);
  assert.doesNotMatch(answer, /quel est le thème|quelle durée|disposez-vous de modèles 3D/i);
});

test('le chat cloud transmet la page courante et l’état récent du pont local', () => {
  const fs = require('node:fs');
  const floating = fs.readFileSync('src/components/FloatingAgent.jsx', 'utf8');
  const assistant = fs.readFileSync('server-assistant.cjs', 'utf8');
  assert.match(floating, /page_context/);
  assert.match(floating, /local_environment/);
  assert.match(floating, /window\.location\.pathname/);
  assert.match(assistant, /pickRelevantTask/);
  assert.match(assistant, /taskContextBlock/);
  assert.match(assistant, /guardTaskAwareAssistantResponse/);
  assert.match(assistant, /videoEnvironmentContext/);
});
