// server.cjs — API uniquement (nginx gère le SPA statique)
const express=require('express'); const app=express(); const PORT=process.env.API_PORT||3001; const {requireSession,requireSameOrigin}=require('./server-security.cjs');
app.set('trust proxy',1); app.use(express.json({limit:'25mb'})); app.use(requireSameOrigin);
function safe(path,mod,guard,label){try{const r=require(mod);app.use(path,...(guard?[guard]:[]),r);console.log(`✅ ${label}`);return r}catch(e){console.warn(`⚠️ ${label}:`,e.message)}}
safe('/api/auth','./server-auth.cjs',null,'Auth');
try{const r=require('./server-email.cjs'),g=requireSession('admin');app.use('/api/emails',(req,res,next)=>req.path==='/official'?next():g(req,res,next),r)}catch(e){console.warn('⚠️ Emails:',e.message)}
safe('/api/documents','./server-documents.cjs',requireSession('collaborateur'),'Documents'); safe('/api/email-compose','./server-email-compose.cjs',requireSession('admin'),'Email compose'); safe('/api/billing','./server-billing.cjs',requireSession('admin'),'Billing');
try{const r=require('./server-insurance.cjs');app.use('/api/insurance',requireSession('client'),r);r.startInsuranceEmailSyncScheduler?.()}catch(e){console.warn('⚠️ Insurance:',e.message)}
safe('/api/data','./server-data-proxy.cjs',requireSession('client'),'Data proxy'); safe('/api/hainoflow','./server-hainoflow.cjs',requireSession('client'),'HainoFlow');
try{const {router:r}=require('./server-ai-cost.cjs');app.use('/api/ai-cost',r)}catch(e){console.warn('⚠️ AI Cost:',e.message)}
safe('/api/assistant','./server-assistant.cjs',requireSession('client'),'Assistant'); safe('/api/emails','./server-email-core.cjs',null,'Email Core'); safe('/api/governance','./server-governance.cjs',null,'Governance'); safe('/api/signage-central','./server-signage.cjs',requireSession('admin'),'Signage central');
app.get('/api/health',(req,res)=>res.json({status:'ok',service:'cockpit-api'})); app.listen(PORT,()=>console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`));
