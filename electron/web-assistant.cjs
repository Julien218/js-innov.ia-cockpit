const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IONOS_START_URL = 'https://my.ionos.fr/domains';
const ALLOWED_IONOS_HOST = /(^|\.)ionos\.(fr|com)$/i;
const MANAGED_IONOS_DOMAINS = new Set([
  'jsinnovia.com', 'jsinnovia.store', 'assurances-dour.be', 'letourdedour.com',
  'oliviertrevis.be', 'synergiedour.be', 'missetmisterdour.be', 'fashionistartdour.be',
]);

function sanitizeWebTask(raw = {}) {
  const provider = String(raw.provider || '').toLowerCase();
  const taskType = String(raw.task_type || '').toLowerCase();
  const domain = String(raw.domain || '').toLowerCase().replace(/\.$/, '');
  let destination;
  try { destination = new URL(String(raw.destination || '')); } catch { throw new Error('Destination web invalide.'); }
  if (provider !== 'ionos' || taskType !== 'domain_redirect') throw new Error('Tâche web non autorisée.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('Domaine invalide.');
  if (!MANAGED_IONOS_DOMAINS.has(domain)) throw new Error('Ce domaine ne fait pas partie du périmètre IONOS géré.');
  if (destination.protocol !== 'https:' || destination.hostname !== `www.${domain}`) {
    throw new Error('La redirection doit cibler le sous-domaine www du même domaine en HTTPS.');
  }
  if (destination.username || destination.password || destination.search || destination.hash) {
    throw new Error('La destination contient des éléments non autorisés.');
  }
  return {
    provider,
    task_type: taskType,
    domain,
    destination: destination.toString().replace(/\/$/, ''),
    preserve_path: raw.preserve_path !== false,
  };
}

function allowedNavigation(url) {
  try { return new URL(url).protocol === 'https:' && ALLOWED_IONOS_HOST.test(new URL(url).hostname); }
  catch { return false; }
}

async function verifyRedirect(task) {
  const pathname = task.preserve_path ? '/mascotte' : '/';
  const source = `https://${task.domain}${pathname}`;
  const expected = `${task.destination}${task.preserve_path ? pathname : ''}`;
  const manual = await fetch(source, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const location = manual.headers.get('location') || '';
  let finalUrl = '';
  try {
    const followed = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    finalUrl = followed.url;
  } catch { /* la preuve manuelle peut suffire */ }
  const directMatch = [301, 302, 307, 308].includes(manual.status)
    && new URL(location, source).toString().startsWith(expected);
  const followedMatch = finalUrl.startsWith(expected);
  return { verified: directMatch || followedMatch, source, expected, status: manual.status, location, final_url: finalUrl };
}

function domStepScript(task, stage) {
  return `(() => {
    const task = ${JSON.stringify(task)};
    const stage = ${JSON.stringify(stage)};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => !!(el && el.getClientRects().length && !el.disabled);
    const candidates = () => [...document.querySelectorAll('button, a, [role="button"], [role="link"], label')].filter(visible);
    const clickText = (patterns, exact = false) => {
      const el = candidates().find((node) => patterns.some((pattern) => exact ? clean(node.textContent) === clean(pattern) : clean(node.textContent).includes(clean(pattern))));
      if (!el) return false;
      el.click();
      return true;
    };
    if (/login|connexion|identifier|password|mot de passe/i.test(document.body.innerText) && !document.body.innerText.includes(task.domain)) {
      return { state: 'needs_login' };
    }
    if (stage === 'domain') {
      if (clickText([task.domain], true) || clickText([task.domain])) return { state: 'progress', next: 'redirect' };
      return { state: 'waiting', reason: 'domain_not_visible' };
    }
    if (stage === 'redirect') {
      if (clickText(['redirection web', 'redirection', 'redirect', 'destination'])) return { state: 'progress', next: 'configure' };
      return { state: 'waiting', reason: 'redirect_option_not_visible' };
    }
    if (stage === 'configure') {
      const inputs = [...document.querySelectorAll('input')].filter(visible);
      const urlInput = inputs.find((input) => /url|destination|adresse|redir/i.test([input.name, input.id, input.placeholder, input.getAttribute('aria-label')].join(' ')))
        || inputs.find((input) => ['url', 'text'].includes(input.type));
      if (!urlInput) return { state: 'waiting', reason: 'destination_input_not_visible' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(urlInput, task.destination);
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      urlInput.dispatchEvent(new Event('change', { bubbles: true }));
      clickText(['permanente (301)', 'permanente', '301']);
      if (task.preserve_path) clickText(['conserver le chemin', 'préserver le chemin', 'forward path', 'tous les chemins']);
      if (clickText(['enregistrer', 'sauvegarder', 'appliquer', 'confirmer'])) return { state: 'progress', next: 'verify' };
      return { state: 'waiting', reason: 'save_button_not_visible' };
    }
    return { state: 'waiting' };
  })()`;
}

async function saveEvidence(win, app, taskId) {
  const image = await win.webContents.capturePage();
  const bytes = image.toPNG();
  const folder = path.join(app.getPath('userData'), 'elynea-evidence');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${taskId}.png`);
  fs.writeFileSync(file, bytes);
  return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function createWebAssistant({ app, getParentWindow }) {
  let activeWindow = null;

  async function execute(rawTask) {
    const task = sanitizeWebTask(rawTask);
    if (activeWindow && !activeWindow.isDestroyed()) throw new Error('Une tâche web Elynea est déjà ouverte.');
    const taskId = crypto.randomUUID();
    let stage = 'domain';
    let lastProgress = Date.now();
    let loginNotified = false;

    activeWindow = new BrowserWindow({
      width: 1220,
      height: 820,
      parent: getParentWindow?.() || undefined,
      title: `Elynea · IONOS · ${task.domain}`,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Identifiant historique conservé pour réutiliser les cookies/session IONOS des installations existantes.
        partition: 'persist:nova-web-ionos',
      },
    });
    activeWindow.removeMenu();
    activeWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (allowedNavigation(url)) {
        activeWindow.loadURL(url);
      }
      return { action: 'deny' };
    });
    activeWindow.webContents.on('will-navigate', (event, url) => {
      if (!allowedNavigation(url)) event.preventDefault();
    });
    await activeWindow.loadURL(IONOS_START_URL);
    activeWindow.show();

    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = async (error, result) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        let evidence = null;
        try { if (activeWindow && !activeWindow.isDestroyed()) evidence = await saveEvidence(activeWindow, app, taskId); } catch { /* preuve facultative en cas d'échec */ }
        if (activeWindow && !activeWindow.isDestroyed()) activeWindow.close();
        activeWindow = null;
        if (error) reject(error);
        else resolve({ ...result, evidence, task_id: taskId });
      };
      activeWindow.on('closed', () => finish(new Error('Tâche interrompue : la fenêtre IONOS a été fermée.')));

      const timer = setInterval(async () => {
        try {
          if (!activeWindow || activeWindow.isDestroyed() || activeWindow.webContents.isLoading()) return;
          if (!allowedNavigation(activeWindow.webContents.getURL())) return finish(new Error('Navigation bloquée hors des domaines IONOS autorisés.'));
          if (stage === 'verify') {
            const proof = await verifyRedirect(task);
            if (proof.verified) return finish(null, { success: true, status: 'verified', details: 'Redirection IONOS vérifiée publiquement.', proof });
            if (Date.now() - lastProgress > 90_000) return finish(new Error(`IONOS a été modifié mais la redirection publique n'est pas encore vérifiable (HTTP ${proof.status}).`));
            return;
          }
          const step = await activeWindow.webContents.executeJavaScript(domStepScript(task, stage), true);
          if (step?.state === 'needs_login') {
            if (!loginNotified) {
              loginNotified = true;
              activeWindow.flashFrame(true);
            }
            if (Date.now() - lastProgress > 5 * 60_000) return finish(new Error('Connexion IONOS non terminée dans le délai prévu.'));
            return;
          }
          if (step?.state === 'progress') {
            stage = step.next;
            lastProgress = Date.now();
            return;
          }
          if (Date.now() - lastProgress > 90_000) {
            return finish(new Error(`Elynea s'est arrêtée sans modifier IONOS : étape introuvable (${step?.reason || stage}).`));
          }
        } catch (error) {
          if (!/destroyed|navigation|frame/i.test(String(error.message))) finish(error);
        }
      }, 1500);
    });
  }

  return { execute };
}

module.exports = { createWebAssistant, sanitizeWebTask, allowedNavigation, verifyRedirect };
