// Runtime facts and bounded read tools. Model text is never execution evidence.
const { hasPermission } = require('./server-permission-policy.cjs');
const { stripInjectedContext } = require('./server-immediate-execution-policy.cjs');
const normal = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
const label = v => String(v || '').replace(/[\r\n<>\[\]`]/g, ' ').slice(0, 180);
const staff = user => ['superadmin', 'admin', 'collaborateur'].includes(user?.role);
const prefKey = user => `elynea-preferences:${encodeURIComponent(user.organisation || 'jsinnovia')}:${encodeURIComponent(user.id)}`;

function preferencesFrom(messages = []) {
  const result = {};
  for (const item of messages) {
    if (item.role !== 'user') continue;
    try {
      const value = JSON.parse(item.content);
      if (value.kind !== 'elynea-preference-v1') continue;
      if (value.reset === true) { for (const key of Object.keys(result)) delete result[key]; continue; }
      if (value.key === 'response_length' && ['courte', 'normale', 'detaillee'].includes(value.value)) result[value.key] = value.value;
      if (value.key === 'address' && ['tutoiement', 'vouvoiement'].includes(value.value)) result[value.key] = value.value;
    } catch {}
  }
  return result;
}
function preferenceChange(message) {
  const text = normal(message);
  if (/^(?:oublie|efface|reinitialise) (?:mes |les )?preferences(?: de conversation)?[.! ]*$/.test(text)) return { reset: true };
  if (!/^(?:retiens|memorise|souviens toi|je prefere|je veux|j aimerais)\b/.test(text)) return null;
  if (/\breponses?\b/.test(text)) {
    const values = [['courte', /\b(courtes?|breves?|concises?)\b/], ['detaillee', /\b(detaillees?|longues?)\b/], ['normale', /\b(normales?)\b/]].filter(([, re]) => re.test(text));
    if (values.length === 1 && !/\bpas\b/.test(text)) return { key: 'response_length', value: values[0][0] };
  }
  if (/\btutoie|\btutoiement/.test(text) && !/\bpas\b/.test(text)) return { key: 'address', value: 'tutoiement' };
  if (/\bvouvoie|\bvouvoiement/.test(text) && !/\bpas\b/.test(text)) return { key: 'address', value: 'vouvoiement' };
  return null;
}
function capabilityFacts({ user, env = process.env, interaction = {} }) {
  const configured = (...names) => names.every(k => Boolean(String(env[k] || '').trim()));
  return {
    documents: staff(user) && hasPermission(user, 'documents'),
    dropbox_configured: Boolean(env.DROPBOX_ACCESS_TOKEN) || configured('DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN'),
    github_read_tool: user?.role === 'superadmin' && Boolean(env.GITHUB_TOKEN || env.GH_TOKEN),
    railway_configured: user?.role === 'superadmin' && Boolean(env.RAILWAY_API_TOKEN || env.RAILWAY_TOKEN),
    media: ['superadmin', 'admin'].includes(user?.role) && hasPermission(user, 'production'),
    cloud_media_configured: configured('XAI_API_KEY', 'MUSIC_MOTION_DATA_DIR'),
    // Current mail providers are organisation-wide, not per-tenant connections.
    email_read_tool: user?.role === 'superadmin' && normal(user.organisation) === 'jsinnovia' && hasPermission(user, 'emails'),
    google_mail_configured: Boolean((env.GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID) && (env.GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET) && env.GOOGLE_MAIL_ENCRYPTION_KEY && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)),
    tasks_read_tool: staff(user) && hasPermission(user, 'tasks'),
    projects_read_tool: staff(user) && hasPermission(user, 'projects'),
    invoices_read_tool: ['superadmin', 'admin'].includes(user?.role) && hasPermission(user, 'invoices'),
    desktop_reported: interaction.desktop === true,
    voice_reported: interaction.voice === true,
  };
}
function capabilityReply(facts) {
  return [
    'Je suis Elynea, l’assistante du Cockpit. Le mode Jarvis relie notre conversation aux fonctions disponibles de l’application.',
    'Le Cockpit peut transcrire ta voix et lire mes réponses. Je reçois cette transcription ; je ne peux pas identifier un locuteur ni diagnostiquer un écho à partir du texte seul.',
    facts.documents ? `Documents : recherche dans l’index autorisé, sélection et téléchargement par la route sécurisée du Cockpit. ${facts.dropbox_configured ? 'La connexion Dropbox est configurée ; chaque lecture doit encore réussir.' : 'La connexion Dropbox est à configurer.'} La recherche ne couvre pas tous les dossiers de ton compte Dropbox.` : '',
    facts.github_read_tool ? 'GitHub : je peux consulter les dépôts accessibles et vérifier un dépôt par API. Une modification de code ou un déploiement nécessite son propre exécuteur ; la présence d’une clé ne prouve pas cette capacité.' : '',
    facts.email_read_tool ? 'Emails : lecture des boîtes IONOS configurées et des comptes Google/Gmail connectés, avec expéditeur, objet et date. Une lecture échouée reste signalée ; aucun message n’est envoyé, classé ou supprimé par cet outil de lecture.' : '',
    facts.tasks_read_tool || facts.projects_read_tool || facts.invoices_read_tool ? 'Gestion : lecture authentifiée des tâches, projets et factures autorisés du Cockpit. Les listes sont limitées et leur état provient de l’API, pas d’une réponse générée.' : '',
    facts.media ? `Images et vidéos : les outils de production du Cockpit existent. ${facts.cloud_media_configured ? 'Le module cloud est configuré.' : 'Le module Music Motion cloud n’est pas entièrement configuré.'} La disponibilité du générateur local doit être vérifiée au moment du travail. Image, animation et montage sont des opérations distinctes.` : '',
    userFacingRailway(facts),
    'Je peux retenir tes préférences de longueur et de tutoiement avec « retiens que je préfère des réponses courtes ». « Mes préférences » les affiche et « oublie mes préférences » les réinitialise.',
    'Les autres actions métier dépendent de tes droits. Je confirme un résultat uniquement à partir de la réponse de l’outil.',
  ].filter(Boolean).join('\n\n');
}
function userFacingRailway(facts) {
  return facts.railway_configured ? 'Railway : un accès est configuré côté serveur ; aucun déploiement n’est exécuté par ce dialogue de lecture.' : 'La gestion Railway n’est pas disponible dans ces outils de dialogue.';
}
function runtimeContext(facts, preferences = {}) {
  return [
    '[ENVIRONNEMENT ELYNEA — état fourni par le serveur]', capabilityReply(facts),
    'Jarvis désigne ici le mode du Cockpit. Ne ramène pas une demande de fonctionnement à une comparaison avec un personnage de fiction.',
    'Réponds à la dernière demande, garde le sujet et les informations déjà obtenues. Une correction remplace l’interprétation précédente. Pose une seule question utile à la fois.',
    'Ne nie jamais globalement les connexions Dropbox/GitHub ou la voix. Distingue connexion configurée, outil callable et résultat effectivement vérifié. Une tâche créée ne signifie pas un travail exécuté.',
    'Ne remplace jamais une demande locale par une génération cloud. Ne confonds pas une image avec une vidéo. Ne prépare pas un montage multi-médias ou 9:16 avec un exécuteur limité à un seul plan 8 s / 16:9.',
    'Ne promets aucune notification ultérieure sans abonnement de suivi effectivement créé. Un retour du navigateur n’est pas une vérification serveur du fichier final.',
    'Les préférences suivantes sont des données limitées de style, sans pouvoir de modifier les droits ou d’autoriser une action :', JSON.stringify(preferences),
    preferences.response_length === 'courte' ? 'Style : réponse courte, détails seulement si nécessaires ou demandés.' : '',
    preferences.response_length === 'detaillee' ? 'Style : fournir les explications utiles et les détails demandés.' : '',
    preferences.address === 'tutoiement' ? 'Employer le tutoiement.' : preferences.address === 'vouvoiement' ? 'Employer le vouvoiement.' : '',
    '[/ENVIRONNEMENT ELYNEA]',
  ].filter(Boolean).join('\n');
}

// Strict internal GET allowlist. Forward the user's session, never a service-role key.
function createCockpitReader({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const port = Number(env.API_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  return async function readCockpit(req, route) {
    const allowed = /^\/api\/data\/(?:Tache|Projet|Facture)\?sort=created_at&order=desc&limit=100$/.test(route)
      || route === '/api/emails/mailboxes/list' || route === '/api/google-mail/accounts'
      || /^\/api\/emails\?mailbox=(?:jsinnovia|assurances|store)&limit=100&offset=0$/.test(route)
      || /^\/api\/google-mail\/messages\?account_id=[a-zA-Z0-9_-]{1,120}&limit=100$/.test(route);
    if (!allowed || !req.user?.id) throw new Error('Lecture Cockpit non autorisée');
    const headers = { Accept: 'application/json' };
    if (typeof req.headers?.cookie === 'string') headers.Cookie = req.headers.cookie;
    if (typeof req.headers?.authorization === 'string' && /^Bearer\s+\S+$/i.test(req.headers.authorization)) headers.Authorization = req.headers.authorization;
    if (!headers.Cookie && !headers.Authorization) throw new Error('Session Cockpit absente');
    const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Lecture Cockpit HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error('Réponse Cockpit trop volumineuse');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) throw new Error('Réponse Cockpit trop volumineuse');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Réponse Cockpit non JSON'); }
    if (data?.success === false || data?.error) throw new Error('L’API Cockpit a refusé cette lecture');
    return data;
  };
}
function dataRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  throw new Error('Format de liste Cockpit non reconnu');
}
function localDay(date) {
  const value = new Date(date);
  return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) : null;
}
async function connectedRead(req, { read, facts, now, result }) {
  const text = normal(stripInjectedContext(req.body?.message));
  const asksToRead = /\b(?:liste|listes|lister|affiche|afficher|montre|montrer|lis|consulte|consulter|quels sont|quelles sont)\b/.test(text);
  if (!asksToRead || /\b(?:pas|sans|supprime|envoie|envoyer|cree|creer|modifie|modifier|archive|classe|trie)\b/.test(text)) return null;
  if (/\b(?:emails?|e mails?|mails?|courriels?|gmail|boites? mail)\b/.test(text)) {
    if (!facts.email_read_tool) return result('La lecture des boîtes centrales nécessite le compte propriétaire JS-Innov.IA et la permission emails. Aucun email consulté.');
    const onlyGoogle = /\b(?:gmail|google)\b/.test(text) && !/\b(?:toutes|tous|ionos)\b/.test(text);
    const onlyIonos = /\b(?:ionos|assurances|store)\b/.test(text) && !/\b(?:toutes|tous|gmail|google)\b/.test(text);
    const today = /\b(?:du jour|de jour|aujourd hui|ce jour)\b/.test(text);
    if (/\b(?:hier|semaine|mois|depuis|avant|apres)\b/.test(text)) return result('Cet outil lit les messages récents ou ceux du jour. Il ne valide pas encore une recherche sur une autre période. Aucun résultat hors période ne sera présenté comme correspondant.');
    const failures = [], accounts = [], messages = [];
    if (!onlyGoogle) {
      try {
        const data = await read(req, '/api/emails/mailboxes/list');
        if (!Array.isArray(data.mailboxes)) throw new Error('invalid mailboxes');
        const selected = /\bassurances\b/.test(text) ? 'assurances' : /\bstore\b/.test(text) ? 'store' : null;
        for (const box of data.mailboxes.filter(row => row.configured && !row.isAlias && (!selected || row.id === selected))) {
          if (!['jsinnovia', 'assurances', 'store'].includes(box.id)) continue;
          accounts.push({ provider: 'ionos', id: box.id, name: label(box.label || box.email) });
        }
      } catch { failures.push('Inventaire IONOS non vérifié.'); }
    }
    if (!onlyIonos) {
      if (facts.google_mail_configured) {
        try {
          const data = await read(req, '/api/google-mail/accounts');
          if (!Array.isArray(data.accounts)) throw new Error('invalid Google accounts');
          const active = data.accounts.filter(row => row.active && /^[a-zA-Z0-9_-]{1,120}$/.test(row.id));
          if (active.length > 10) failures.push('Seuls les dix premiers comptes Google sont consultés.');
          for (const box of active.slice(0, 10)) accounts.push({ provider: 'google', id: box.id, name: label(box.label || box.email) });
        } catch { failures.push('Inventaire Google/Gmail non vérifié.'); }
      } else if (onlyGoogle) failures.push('Connexion Google/Gmail non configurée.');
    }
    const checked = [];
    // Bounded concurrency; one failed mailbox never becomes an empty successful result.
    for (let start = 0; start < accounts.length; start += 3) {
      await Promise.all(accounts.slice(start, start + 3).map(async account => {
        try {
          const route = account.provider === 'google' ? `/api/google-mail/messages?account_id=${encodeURIComponent(account.id)}&limit=100` : `/api/emails?mailbox=${account.id}&limit=100&offset=0`;
          const data = await read(req, route);
          if (!Array.isArray(data.emails)) throw new Error('invalid emails');
          checked.push(account.name);
          for (const row of data.emails.slice(0, 100)) {
            if (today && localDay(row.date) !== localDay(now())) continue;
            messages.push({ mailbox: account.name, provider: account.provider, id: String(row.uid || row.id || ''), from: label(typeof row.from === 'string' ? row.from : row.from?.address || row.from?.text), subject: label(row.subject || '(sans objet)'), date: row.date || null });
          }
        } catch { failures.push(`${account.name} : lecture impossible, contenu non vérifié.`); }
      }));
    }
    messages.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    const items = messages.slice(0, 40);
    return result([
      checked.length ? `Emails ${today ? `du ${localDay(now())} (Europe/Brussels)` : 'récents'} — boîtes réellement consultées : ${checked.join(', ')}.` : 'Aucune boîte n’a pu être consultée.',
      ...items.map((row, index) => `${index + 1}. [${row.mailbox}] ${row.subject} — ${row.from || 'expéditeur non renseigné'} — ${label(row.date || 'date non renseignée')}`),
      checked.length && !items.length ? 'Aucun message correspondant dans la fenêtre consultée.' : '',
      'Périmètre : boîte de réception, 100 messages récents par compte au maximum, 40 résultats affichés. Cette liste n’est pas un inventaire exhaustif. Aucun email marqué comme lu, envoyé, classé ou supprimé.',
      ...failures,
    ].filter(Boolean).join('\n'), { source: 'cockpit-email-api', checked_at: new Date(now()).toISOString(), partial: failures.length > 0, checked_mailboxes: checked, items });
  }
  if (/\b(?:dropbox|documents?|fichiers?)\b/.test(text)) return null;
  const match = [
    ['tasks_read_tool', 'Tache', /\btaches?\b/, 'Tâches'],
    ['projects_read_tool', 'Projet', /\bprojets?\b/, 'Projets'],
    ['invoices_read_tool', 'Facture', /\bfactures?\b/, 'Factures du module facturation'],
  ].filter(([, , pattern]) => pattern.test(text));
  if (match.length !== 1) return null;
  const [permission, table, , title] = match[0];
  if (!facts[permission]) return result('Ton compte ne permet pas de consulter ces données du Cockpit.');
  const rows = dataRows(await read(req, `/api/data/${table}?sort=created_at&order=desc&limit=100`));
  const projectId = String(req.body?.project_id || '');
  const filtered = rows.filter(row => !projectId || String(table === 'Projet' ? row.id : row.projet_id || row.project_id || '') === projectId);
  const items = filtered.slice(0, 20).map(row => ({ id: String(row.id || ''), label: label(row.titre || row.nom || row.numero || row.objet || row.id), status: label(row.statut || row.status || 'non renseigné') }));
  return result([`${title} — état lu dans l’API du Cockpit${projectId ? ' pour le projet sélectionné' : ''} :`, ...items.map((row, index) => `${index + 1}. ${row.label} — ${row.status} — ID : ${row.id}`), !items.length ? 'Aucun résultat dans la fenêtre consultée.' : '', 'Lecture limitée aux 100 enregistrements récents accessibles, 20 affichés. Un statut de tâche ne prouve pas un rendu terminé.'].filter(Boolean).join('\n'), { source: 'cockpit-data-api', checked_at: new Date(now()).toISOString(), items });
}

function createRuntime({ listDocuments, getDocument, github, loadPreferences, savePreference, now = Date.now, env = process.env, readCockpit }) {
  const read = readCockpit || createCockpitReader({ env });
  const selections = new Map();
  function scope(req) { return JSON.stringify([req.user.organisation, req.user.id, String(req.body?.conversation_id || 'main'), String(req.body?.project_id || '')]); }
  function selection(req) { const item = selections.get(scope(req)); return item?.expires > now() ? item : null; }
  function remember(req, value) {
    for (const [key, item] of selections) if (item.expires <= now()) selections.delete(key);
    if (selections.size >= 500) selections.delete(selections.keys().next().value);
    selections.set(scope(req), { ...value, expires: now() + 15 * 60_000 });
  }
  const result = (message, extra = {}) => ({ message, confirmation: null, model_used: 'elynea-runtime', ...extra });
  async function handle(req) {
    const message = stripInjectedContext(req.body?.message), text = normal(message);
    const facts = capabilityFacts({ user: req.user, env, interaction: req.body?.interaction });
    const change = preferenceChange(message);
    if (change) {
      await savePreference(prefKey(req.user), { kind: 'elynea-preference-v1', ...change });
      return result(change.reset ? 'Tes préférences de conversation ont été réinitialisées.' : `C’est retenu : ${change.value === 'courte' ? 'des réponses courtes' : change.value === 'detaillee' ? 'des réponses détaillées' : change.value === 'normale' ? 'des réponses de longueur normale' : change.value}.`, { preference_saved: true });
    }
    if (/^(?:quelles sont |affiche |montre )?(?:mes |les )preferences(?: de conversation)?[ ?.!]*$/.test(text)) {
      const prefs = preferencesFrom(await loadPreferences(prefKey(req.user)));
      return result(Object.keys(prefs).length ? `Préférences enregistrées : ${Object.values(prefs).join(', ')}.` : 'Aucune préférence de conversation enregistrée.');
    }
    if ((/\b(outils?|capacites?|acces|connecte|connectee)\b/.test(text) && /\b(quels?|quelles?|liste|dis moi|as tu|tu as|a quoi|a quel|de quel|disposition)\b/.test(text)) || (/\b(jarvis|jervis)\b/.test(text) && !/\b(film|marvel|iron man)\b/.test(text)) || /\b(tu reponds a ma voix|tu fonctionnes.*texte|tu.*entendu ta voix|tu.*entends ma voix)\b/.test(text)) return result(capabilityReply(facts), { capabilities: facts });
    if (/(?:ne |n )?(?:telecharge|cherche|liste|ouvre).*\bpas\b|\bsans (?:telecharger|chercher|ouvrir)\b/.test(text)) return null;
    const operational = await connectedRead(req, { read, facts, now, result });
    if (operational) return operational;
    const previous = selection(req);
    if (/\btelecharg\w*/.test(text) && (/\b(facture|document|fichier|dropbox)\b/.test(text) || previous?.kind === 'documents' || /\b(premiere?|deuxieme?|seconde?|troisieme?|derniere?)\b/.test(text))) {
      if (!facts.documents) return result('Ton compte ne permet pas de consulter ces documents.');
      if (previous?.kind !== 'documents') return result('Il me faut d’abord retrouver le document. Quel est son nom ou son numéro de facture ?');
      let matches = previous.items.filter(row => text.includes(normal(row.filename)));
      const order = /\b(premiere?|deuxieme?|seconde?|troisieme?|derniere?)\b/.exec(text)?.[1];
      if (order) matches = [previous.items[order.startsWith('prem') ? 0 : /^(deux|second)/.test(order) ? 1 : order.startsWith('trois') ? 2 : previous.items.length - 1]].filter(Boolean);
      if (!matches.length && previous.items.length === 1) matches = previous.items;
      if (matches.length !== 1) return result('Quel fichier veux-tu télécharger dans la dernière liste ?');
      const row = await getDocument(req.user, matches[0].id);
      const url = `/api/documents/${encodeURIComponent(row.id)}/download`;
      return result(`J’ai retrouvé ${label(row.filename)}. Je lance la récupération du fichier.`, { download: { url, filename: row.filename }, action_type: 'download_document' });
    }
    if ((/\b(dropbox|documents?|fichiers?)\b/.test(text) && /\b(cherche|recherche|trouve|trouver|retrouve|liste|montre|factures?)\b/.test(text)) || (/^les factures[.! ]*$/.test(text))) {
      if (!facts.documents) return result('Ton compte ne permet pas de consulter les documents du Cockpit.');
      if (!facts.dropbox_configured) return result('La connexion Dropbox n’est pas configurée pour les fichiers.');
      const rows = await listDocuments(req.user);
      const terms = text.replace(/s il te plait|peux tu|pourrais tu/g, ' ').split(/[^a-z0-9-]+/).filter(t => t.length > 2 && !['cherche','recherche','trouve','trouver','retrouve','liste','montre','dropbox','documents','document','fichiers','fichier','dans','les','des','mes','une','moi','pour','veux','merci','qui','sont','enregistres','enregistrees'].includes(t));
      const filtered = rows.filter(row => terms.every(term => /^(facture|factures)$/.test(term) ? /factur|\bfac[-_]/.test(normal(row.filename + ' ' + row.category)) : normal(row.filename + ' ' + row.category).includes(term)));
      const items = filtered.slice(0, 20);
      remember(req, { kind: 'documents', items });
      return result(items.length ? ['Documents trouvés dans l’index du Cockpit, stockés dans Dropbox :', ...items.map((row, i) => `${i + 1}. ${label(row.filename)}`), 'Tu peux demander « télécharge la deuxième ». Recherche limitée aux 200 documents les plus récents de ton organisation.'].join('\n') : 'Aucun document correspondant dans les 200 documents les plus récents de l’index Cockpit. Cela ne signifie pas que ton compte Dropbox est vide.', { source: 'cockpit-document-index', inspected: rows.length });
    }
    if (/\b(github|depot|depots|repository|repo)\b/.test(text) && /\b(liste|montre|consulte|verifie|inspecte|etat|lis|accessible|acces)\b/.test(text)) {
      if (!facts.github_read_tool) return result('La consultation GitHub nécessite un compte propriétaire et une connexion GitHub configurée.');
      const match = message.match(/(?:github\.com\/)?([a-z\d][a-z\d-]{0,38})\/([\w.-]{1,100})/i);
      if (match) {
        const repo = `${match[1]}/${match[2].replace(/\.git$/, '')}`;
        const data = await github(`/repos/${repo.split('/').map(encodeURIComponent).join('/')}`);
        remember(req, { kind: 'github', repository: data.full_name });
        return result(`Dépôt GitHub vérifié : ${label(data.full_name)}.\nBranche par défaut : ${label(data.default_branch)}.\nLecture : ${data.permissions?.pull ? 'autorisée' : 'réponse API reçue'}. Écriture : ${data.permissions?.push ? 'autorisée par le jeton' : 'non confirmée'}.\n${label(data.description || '')}\nAucun fichier modifié.`, { source: 'github-api', checked_at: new Date(now()).toISOString() });
      }
      const repos = await github('/user/repos?per_page=30&sort=updated&affiliation=owner,collaborator,organization_member');
      return result(['Dépôts GitHub accessibles (30 récemment modifiés au maximum) :', ...repos.map(r => `- ${label(r.full_name)}`), 'Pour en consulter un : « vérifie le dépôt propriétaire/nom ».'].join('\n'), { source: 'github-api' });
    }
    return null;
  }
  async function context(req) {
    let preferences = {};
    try { preferences = preferencesFrom(await loadPreferences(prefKey(req.user))); } catch {}
    return runtimeContext(capabilityFacts({ user: req.user, env, interaction: req.body?.interaction }), preferences);
  }
  return { handle, context };
}
module.exports = { createRuntime, capabilityFacts, capabilityReply, runtimeContext, preferenceChange, preferencesFrom, prefKey, createCockpitReader, connectedRead, localDay };
