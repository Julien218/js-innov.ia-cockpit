const DIAGNOSTIC_INTENT = /(?:diagnostic|diagnostique|teste|tester|test|v[ée]rifie|contr[ôo]le|[ée]tat|status|statut|comfyui|h3|video\s*studio|agent\s*local|mode\s*local|cockpit|8787|8188)/i;
const H3_WORKFLOW_KEY = 'jsinnovia.video.workflow.h3-i2v';
const VIDEO_MODE_KEY = 'jsinnovia.video.mode';

function safeText(value, max = 160) {
  return String(value || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
      ollama_online: Boolean(data?.ollama?.online ?? data?.ollama_online ?? response.ok),
    };
  } catch (error) {
    return { online: false, error: safeText(error?.message || 'injoignable', 120) };
  }
}

async function videoDiagnostic() {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.videoLocal : null;
  if (!bridge?.status) {
    return {
      desktop_bridge: false,
      comfyui_online: false,
      ffmpeg_online: false,
      reason: 'desktop_bridge_unavailable',
    };
  }

  try {
    const status = await bridge.status();
    const stats = status?.comfyui?.stats || {};
    return {
      desktop_bridge: true,
      comfyui_online: Boolean(status?.comfyui?.online),
      comfyui_version: safeText(stats?.system?.comfyui_version || stats?.comfyui_version, 80),
      ffmpeg_online: Boolean(status?.ffmpeg?.online),
      ffmpeg_version: safeText(status?.ffmpeg?.version, 120),
      endpoint: 'http://127.0.0.1:8188',
    };
  } catch (error) {
    return {
      desktop_bridge: true,
      comfyui_online: false,
      ffmpeg_online: false,
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
    return { h3_workflow_ready: false, video_mode: 'unknown' };
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
    `Agent Local 8787: ${agent.online ? 'en ligne' : 'hors ligne'}${agent.model ? `; modèle=${agent.model}` : ''}${agent.ollama_online ? '; Ollama=en ligne' : ''}.`,
    `Mode vidéo: ${safeText(video.video_mode || 'inconnu', 20)}.`,
    `Bridge vidéo Electron: ${video.desktop_bridge ? 'disponible' : 'indisponible'}.`,
    `ComfyUI 8188: ${video.comfyui_online ? 'en ligne' : 'hors ligne/non mesuré'}${video.comfyui_version ? `; version=${video.comfyui_version}` : ''}.`,
    `FFmpeg: ${video.ffmpeg_online ? 'disponible' : 'non détecté/non mesuré'}.`,
    `Workflow MiniMax H3 local mémorisé: ${video.h3_workflow_ready ? 'oui' : 'non'}.`,
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
