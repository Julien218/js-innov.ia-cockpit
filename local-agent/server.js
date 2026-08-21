import express from 'express';
import crypto from 'node:crypto';

const app = express();
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8787);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';
const TOKEN = String(process.env.LOCAL_AGENT_TOKEN || '').trim();
const approvals = new Map();

const ALLOWED_ORIGINS = new Set([
  'https://cockpit.jsinnovia.com',
]);
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

app.use(express.json({ limit: '5mb' }));
app.use((req,res,next)=>{
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  // Compatibilité avec les navigateurs qui utilisent encore le préflight
  // Private Network Access. Chrome récent utilise surtout Local Network Access.
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use((req,res,next)=>{
  if (!TOKEN || req.path==='/health') return next();
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.status(401).json({ok:false,error:'unauthorized'});
  next();
});

async function ollama(prompt, model=DEFAULT_MODEL){
  const r=await fetch(`${OLLAMA_URL}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,format:'json'}),signal:AbortSignal.timeout(120000)});
  const p=await r.json(); if(!r.ok) throw new Error(p?.error||`Ollama ${r.status}`); return p.response;
}
function architectPrompt(request, context){return `Tu es l'Architecte JS-Innov.IA. Analyse la demande sans modifier aucun système. Réutilise les modules existants avant d'en créer. Réponds UNIQUEMENT en JSON avec: summary, existing_reuse[], modules_to_create[], risks[], tests[], tasks[] où chaque task contient title, agent (code|test|security|devops|docs), action, requires_approval. Toute écriture GitHub, Railway, Supabase, Dropbox ou production doit requires_approval=true.\nDEMANDE:\n${request}\nCONTEXTE:\n${JSON.stringify(context||{}).slice(0,20000)}`}

app.get('/health',async(_req,res)=>{
  let ollamaOnline=false, models=[]; try{const r=await fetch(`${OLLAMA_URL}/api/tags`,{signal:AbortSignal.timeout(2500)});const p=await r.json();ollamaOnline=r.ok;models=(p.models||[]).map(x=>x.name)}catch{}
  res.json({ok:true,agent:{name:'JS-Innov.IA AI Factory Local',version:'1.0.0',mode:'local-first',approvalGate:true},services:{ollama:{online:ollamaOnline,url:OLLAMA_URL,models}}});
});
app.post('/architect/analyze',async(req,res)=>{
  try{if(!req.body?.request) return res.status(400).json({ok:false,error:'request_required'});const raw=await ollama(architectPrompt(req.body.request,req.body.context),req.body.model);let plan;try{plan=JSON.parse(raw)}catch{plan={summary:raw,tasks:[]}};const id=crypto.randomUUID();approvals.set(id,{id,status:'pending',createdAt:new Date().toISOString(),request:req.body.request,plan});res.json({ok:true,analysisId:id,status:'pending_validation',plan});}catch(e){res.status(502).json({ok:false,error:'architect_failed',message:e.message})}
});
app.get('/validations',(req,res)=>res.json({ok:true,items:[...approvals.values()]}));
app.post('/validations/:id/approve',(req,res)=>{const a=approvals.get(req.params.id);if(!a)return res.status(404).json({ok:false,error:'not_found'});a.status='approved';a.approvedAt=new Date().toISOString();res.json({ok:true,item:a})});
app.post('/validations/:id/reject',(req,res)=>{const a=approvals.get(req.params.id);if(!a)return res.status(404).json({ok:false,error:'not_found'});a.status='rejected';a.rejectedAt=new Date().toISOString();res.json({ok:true,item:a})});
app.listen(PORT,'127.0.0.1',()=>console.log(`JS-Innov.IA AI Factory Local http://127.0.0.1:${PORT}`));
