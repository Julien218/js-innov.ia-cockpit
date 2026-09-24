// Runtime facts and bounded read tools. Model text is never execution evidence.
const { hasPermission } = require('./server-permission-policy.cjs');
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
    facts.media ? `Images et vidéos : les outils de production du Cockpit existent. ${facts.cloud_media_configured ? 'Le module cloud est configuré.' : 'Le module Music Motion cloud n’est pas entièrement configuré.'} La disponibilité du générateur local doit être vérifiée au moment du travail.` : '',
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
    '[ENVIRONNEMENT ELYNEA — état fourni par le serveur]',
    capabilityReply(facts),
    'Jarvis désigne ici le mode du Cockpit. Ne ramène pas une demande de fonctionnement à une comparaison avec un personnage de fiction.',
    'Réponds à la dernière demande, garde le sujet et les informations déjà obtenues. Une correction remplace l’interprétation précédente. Pose une seule question utile à la fois.',
    'Ne nie jamais globalement les connexions Dropbox/GitHub ou la voix. Distingue connexion configurée, outil callable et résultat effectivement vérifié. Une tâche créée ne signifie pas un travail exécuté.',
    'Les préférences suivantes sont des données limitées de style, sans pouvoir de modifier les droits ou d’autoriser une action :',
    JSON.stringify(preferences),
    preferences.response_length === 'courte' ? 'Style : réponse courte, détails seulement si nécessaires ou demandés.' : '',
    preferences.response_length === 'detaillee' ? 'Style : fournir les explications utiles et les détails demandés.' : '',
    preferences.address === 'tutoiement' ? 'Employer le tutoiement.' : preferences.address === 'vouvoiement' ? 'Employer le vouvoiement.' : '',
    '[/ENVIRONNEMENT ELYNEA]',
  ].filter(Boolean).join('\n');
}

function createRuntime({ listDocuments, getDocument, github, loadPreferences, savePreference, now = Date.now, env = process.env }) {
  const selections = new Map();
  function scope(req) { return JSON.stringify([req.user.organisation, req.user.id, String(req.body?.conversation_id || 'main')]); }
  function selection(req) { const item = selections.get(scope(req)); return item?.expires > now() ? item : null; }
  function remember(req, value) {
    for (const [key, item] of selections) if (item.expires <= now()) selections.delete(key);
    if (selections.size >= 500) selections.delete(selections.keys().next().value);
    selections.set(scope(req), { ...value, expires: now() + 15 * 60_000 });
  }
  const result = (message, extra = {}) => ({ message, confirmation: null, model_used: 'elynea-runtime', ...extra });
  async function handle(req) {
    const message = String(req.body?.message || '').trim(), text = normal(message);
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
    const previous = selection(req);
    if (/\btelecharg\w*/.test(text) && (/\b(facture|document|fichier|dropbox)\b/.test(text) || previous?.kind === 'documents' || /\b(premiere?|deuxieme?|seconde?|troisieme?|derniere?)\b/.test(text))) {
      if (!facts.documents) return result('Ton compte ne permet pas de consulter ces documents.');
      if (previous?.kind !== 'documents') return result('Il me faut d’abord retrouver le document. Quel est son nom ou son numéro de facture ?');
      let matches = previous.items.filter(row => text.includes(normal(row.filename)));
      const order = /\b(premiere?|deuxieme?|seconde?|troisieme?|derniere?)\b/.exec(text)?.[1];
      if (order) matches = [previous.items[order.startsWith('prem') ? 0 : /^(deux|second)/.test(order) ? 1 : order.startsWith('trois') ? 2 : previous.items.length - 1]].filter(Boolean);
      if (!matches.length && previous.items.length === 1) matches = previous.items;
      if (matches.length !== 1) return result('Quel fichier veux-tu télécharger dans la dernière liste ?');
      // Recheck access and existence, even when a conversation has cached the identifier.
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
module.exports = { createRuntime, capabilityFacts, capabilityReply, runtimeContext, preferenceChange, preferencesFrom, prefKey };
