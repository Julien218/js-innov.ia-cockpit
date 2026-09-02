const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

test('l’image Railway embarque tous les modules serveur racine', () => {
  assert.match(dockerfile, /COPY --from=builder \/app\/server\*\.cjs \.\//);
});

test('le contexte de tâche et les routes de dispatch sont contrôlés dans l’image finale', () => {
  assert.match(dockerfile, /test -f \/app\/server-task-context\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-task-context\.cjs/);
  assert.match(dockerfile, /require\('\/app\/server-assistant-batch\.cjs'\)/);
  assert.match(dockerfile, /require\('\/app\/server-specialist-tasks\.cjs'\)/);
  assert.match(dockerfile, /require\('\/app\/server-base44-agents\.cjs'\)/);
});
