const DEFAULT_AGENT_URL = "http://127.0.0.1:8787";

export function getLocalAgentUrl() {
  if (typeof window === "undefined") return DEFAULT_AGENT_URL;
  return window.localStorage.getItem("jsinnovia.localAgentUrl") || DEFAULT_AGENT_URL;
}

export function setLocalAgentUrl(url) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("jsinnovia.localAgentUrl", url || DEFAULT_AGENT_URL);
}

async function request(path, options = {}) {
  const baseUrl = getLocalAgentUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.error || payload?.message;
    throw new Error(message || `Erreur agent local ${response.status}`);
  }

  return payload;
}

export const localAiClient = {
  health: () => request("/health"),

  createProject: ({ name, basePath }) => request("/projects/create", {
    method: "POST",
    body: { name, basePath },
  }),

  generateDourPlayaPlan: ({ durationSeconds = 146, format = "9:16", stylePrompt = "" } = {}) => request("/prompts/dour-playa-plan", {
    method: "POST",
    body: { durationSeconds, format, stylePrompt },
  }),

  generateWithOllama: ({ model = "llama3.1", prompt }) => request("/ollama/generate", {
    method: "POST",
    body: { model, prompt },
  }),

  submitComfyWorkflow: ({ workflow, clientId }) => request("/comfy/prompt", {
    method: "POST",
    body: { workflow, client_id: clientId },
  }),

  assembleVideo: ({ clips, audioPath, outputPath }) => request("/video/assemble", {
    method: "POST",
    body: { clips, audioPath, outputPath },
  }),
};
