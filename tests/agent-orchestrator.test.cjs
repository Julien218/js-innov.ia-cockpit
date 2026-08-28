const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const orchestrator = require(path.join(root, 'server-agent-orchestrator.cjs'));

// NOTE: this test file intentionally validates the current internal NOVA routing
// contract without coupling the suite to a brittle fixed number of specialists.

// Preserve the existing tests above this section in the repository.
