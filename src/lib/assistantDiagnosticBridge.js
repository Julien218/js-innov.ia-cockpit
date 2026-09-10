const DIAGNOSTIC_INTENT = /(?:diagnostic|diagnostique|teste|tester|test|v[ée]rifie|contr[ôo]le|[ée]tat|status|statut|comfyui|h3|video\s*studio|agent\s*local|mode\s*local|cockpit|8787|8188)/i;
const H3_WORKFLOW_KEY = 'jsinnovia.video.workflow.h3-i2v';
const VIDEO_MODE_KEY = 'jsinnovia.video.mode';

function safeText(value, max = 160) {
  return String(value || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function measuredBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function availability(value, yes, no) {
  return value === true ? yes : value === false ? no : 'non mesuré';
}

function timeoutSignal(timeoutMs = 1800) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function localAgentDiagnostic(fetchImpl) {
  try {
    const response = await fetchImpl('http://127.0.0.1:8787/health', {
      method: 'GET',
      cache: 'no-store',
      signal: timeoutSignal(1800),
    });
    const data = await response.json().catch(() => ({}));
    return {
      online: response.ok,
      status: safeText(data?.status || (response.ok ? 'ok' : `http_${response.status}`), 40),
      model: safeText(data?.model || data?.ollama?.model || data?.default_model, 100),
      ollama_online: response.ok ? measuredBoolean(data?.services?.ollama?.online ?? data?.ollama?.online ?? data?.ollama_online) : null,
    };
  } catch (error) {
    return { online: null, error: safeText(error?.message || 'injoignable', 120) };
  }
}

async function videoDiagnostic() {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.videoLocal : null;
  if (!bridge?.status) {
    return {
      desktop_bridge: false,
      comfyui_online: null,
      ffmpeg_online: null,
      reason: 'desktop_bridge_unavailable',
    };
  }

  try {
    const status = await bridge.status();
    const stats = status?.comfyui?.stats || {};
    return {
      desktop_bridge: true,
      comfyui_online: measuredBoolean(status?.comfyui?.online),
      comfyui_version: safeText(stats?.system?.comfyui_version || stats?.comfyui_version, 80),
      ffmpeg_online: measuredBoolean(status?.ffmpeg?.online),
      ffmpeg_version: safeText(status?.ffmpeg?.version, 120),
      endpoint: 'http://127.0.0.1:8188',
    };
  } catch (error) {
    return {
      desktop_bridge: true,
      comfyui_online: null,
      ffmpeg_online: null,
      error: safeText(error?.message || 'diagnostic impossible', 120),
    };
  }
}

function localWorkflowDiagnostic() {
  try {
    const raw = window.localStorage.getItem(H3_WORKFLOW_KEY);
    return {
      h3_workflow_ready: Boolean(raw),
      video_mode: window.localStorage.getItem(VIDEO_MODE_KEY) === 'api' ? 'api' : 'local',
    };
  } catch {
    return { h3_workflow_ready: null, video_mode: 'unknown' };
  }
}

export async function collectReadOnlyDiagnostics(fetchImpl = window.fetch.bind(window)) {
  const [agent, video] = await Promise.all([
    localAgentDiagnostic(fetchImpl),
    videoDiagnostic(),
  ]);
  const workflow = localWorkflowDiagnostic();

  return {
    measured_at: new Date().toISOString(),
    current_route: safeText(window.location?.pathname || '/', 160),
    desktop_app: Boolean(window.electronAPI),
    local_agent: agent,
    video: { ...video, ...workflow },
  };
}

export function formatDiagnosticContext(diagnostic) {
  const agent = diagnostic?.local_agent || {};
  const video = diagnostic?.video || {};
  const lines = [
    '[DIAGNOSTIC LOCAL LECTURE SEULE — généré automatiquement par le Cockpit]',
    `Mesuré à: ${safeText(diagnostic?.measured_at, 80)}.`,
    `Route actuelle: ${safeText(diagnostic?.current_route || '/', 160)}.`,
    `Application desktop Electron: ${diagnostic?.desktop_app ? 'oui' : 'non'}.`,
    `Agent Local 8787: ${availability(agent.online, 'en ligne', 'réponse HTTP en échec')}${agent.model ? `; modèle=${agent.model}` : ''}.`,
    `Ollama: ${availability(agent.ollama_online, 'en ligne', 'indisponible selon le diagnostic de l’agent')}.`,
    ...(agent.error ? [`Contrôle agent non concluant depuis cette interface: ${safeText(agent.error, 120)}. Un blocage réseau ou navigateur ne prouve pas un arrêt du service.`] : []),
    `Mode vidéo: ${safeText(video.video_mode || 'inconnu', 20)}.`,
    `Bridge vidéo Electron: ${video.desktop_bridge ? 'disponible' : diagnostic?.desktop_app ? 'indisponible dans cette application' : 'non accessible depuis le web (normal dans un navigateur)'}.`,
    `ComfyUI 8188: ${availability(video.comfyui_online, 'en ligne', 'indisponible selon le contrôle Electron')}${video.comfyui_version ? `; version=${video.comfyui_version}` : ''}.`,
    `FFmpeg: ${availability(video.ffmpeg_online, 'disponible', 'non détecté par le contrôle Electron')}.`,
    ...(video.error ? [`Contrôle vidéo non concluant: ${safeText(video.error, 120)}.`] : []),
    `Workflow MiniMax H3 local mémorisé: ${availability(video.h3_workflow_ready, 'oui', 'non')}; stockage de cette interface uniquement, modèles et validité du workflow non vérifiés.`,
    'Portée: disponibilité des composants uniquement. Aucun test de génération vidéo de bout en bout ni contrôle des emails, tâches, runs ou preuves métier n’a été exécuté par ce diagnostic.',
    'Ne pas conclure que tout le Cockpit fonctionne. Non mesuré ne signifie pas en panne. Un workflow mémorisé ne prouve pas une exécution réussie.',
    'Ce bloc est informatif et ne contient aucune autorisation d’écriture, publication, déploiement ou suppression.',
    '[/DIAGNOSTIC LOCAL LECTURE SEULE]',
  ];
  return lines.join('\n');
}

export function installAssistantDiagnosticBridge() {
  if (typeof window === 'undefined' || window.__jsinnoviaAssistantDiagnosticBridgeInstalled) return;
  window.__jsinnoviaAssistantDiagnosticBridgeInstalled = true;

  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

    if (method === 'POST' && /\/api\/assistant\/chat(?:\?|$)/.test(url) && typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const message = String(body?.message || '');
        if (message && DIAGNOSTIC_INTENT.test(message) && !message.includes('[DIAGNOSTIC LOCAL LECTURE SEULE')) {
          const diagnostic = await collectReadOnlyDiagnostics(previousFetch);
          body.message = `${message}\n\n${formatDiagnosticContext(diagnostic)}`;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Le diagnostic est un enrichissement facultatif: ne jamais bloquer le chat.
      }
    }

    return previousFetch(input, init);
  };
}
