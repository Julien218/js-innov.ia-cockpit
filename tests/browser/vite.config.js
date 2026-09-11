import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
// Manual browser regression fixture. Binds localhost; all writes stay in memory.
export default defineConfig({
  envPrefix: '__NO_ENV__', plugins: [react(), {
    name:'isolated-api-fixture',
    configureServer(server) {
      const projects = []; let fail = false;
      server.middlewares.use((req,res,next) => {
        const url = new URL(req.url, 'http://localhost');
        const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
        if (url.pathname === '/__fixture/fail') { fail = true; return send(200, {ok:true}); }
        if (url.pathname === '/__fixture/state') return send(200, {projects});
        if (url.pathname.startsWith('/api/')) {
          if (fail) { fail = false; return send(502, {error:'Erreur serveur simulée pour le test.'}); }
          if (url.pathname === '/api/video-studio/projects') {
            if (req.method === 'POST') {
              let body = ''; req.on('data', chunk => { body += chunk; });
              return req.on('end', () => { const project = {...JSON.parse(body),id:`fixture-${projects.length + 1}`}; projects.push(project); send(201,project); });
            }
            return send(200, projects.filter(p => !url.searchParams.has('id') || url.searchParams.get('id') === p.id));
          }
          if (url.pathname === '/api/video-studio/exports') return send(200, [
            {id:'legacy',title:'Ancien export',file_url:'/fixture-missing.webm',file_size_mb:'2.5',duration_seconds:'60'},
            {id:'missing',title:null,export_type:null,file_size_mb:null,status:'completed'}
          ]);
          return send(503, {error:'API désactivée dans le test isolé.'});
        }
        if (url.pathname === '/fixture-missing.webm') return send(404, {error:'Fichier test absent.'});
        if (!path.extname(url.pathname) && !url.pathname.startsWith('/@')) req.url = '/tests/browser/index.html';
        next();
      });
    }
  }], resolve:{alias:{'@':path.resolve('src')}}, server:{host:'127.0.0.1',port:4179,strictPort:true}
});
