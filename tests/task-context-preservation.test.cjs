const test = require('node:test');
const assert = require('node:assert/strict');

const { enrichTaskBatchWithRequestContext } = require('../server-task-context.cjs');

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
