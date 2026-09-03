const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
let installed = false;

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  if (installed) return exported;
  try {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (path.basename(resolved) === 'server-assistant.cjs' && exported?.post) {
      require('./server-nova-document-upload.cjs').installNovaDocumentRoutes(exported);
      installed = true;
      console.log('✅ NOVA accepte et analyse les factures PDF fournisseurs');
    }
  } catch (error) {
    console.warn('[nova-document-preload] installation ignorée:', error.message);
  }
  return exported;
};
