import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const app = express();
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8787);
const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LOCAL_PROJECTS_PATH = process.env.LOCAL_PROJECTS_PATH || path.join(os.homedir(), "Documents", "Js-Innov.IA");

app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function ok(data) {
  return { ok: true, ...data };
}

function fail(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function probeJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    return { online: response.ok, status: response.status, data };
  } catch (error) {
    return { online: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeFfmpeg() {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"], { timeout: 3000 });
    const firstLine = stdout.split("\n")[0]?.trim();
    return { online: true, version: firstLine };
  } catch (error) {
    return { online: false, error: error.message };
  }
}

function sanitizeSegment(value) {
  return String(value || "Projet IA")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Projet IA";
}

function toPosixForFfmpeg(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function secondsToTimecode(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function buildDourPlayaPlan({ durationSeconds = 146, format = "9:16", stylePrompt = "" }) {
  const ranges = [
    [0, 10, "Intro — Dour se réveille", "Drone au lever du soleil sur Dour, kiosque et jets d'eau qui s'activent progressivement."],
    [10, 22, "Les mascottes arrivent", "Les mascottes courent vers la caméra avec éclaboussures, confettis et énergie explosive."],
    [22, 34, "Dour Playa lance la fête", "Danse collective devant le kiosque, jets d'eau synchronisés et ambiance festival."],
    [34, 46, "Toboggan géant", "Descente rapide sur le toboggan avec caméra embarquée, rires et splashs."],
    [46, 59, "Jets d'eau en folie", "Chorégraphie lumineuse autour des jets d'eau avec caméra 360 degrés."],
    [59, 72, "Ambiance plage", "Plage tropicale au pied des terrils, transats, palmiers, flamants roses et détente solaire."],
    [72, 85, "Dour by night", "Nuit néon, lasers, mapping sur la tour rouge et ambiance festival."],
    [85, 98, "Le kiosque envahi", "Les mascottes montent sur le kiosque, DJ set, confettis et foule en fête."],
    [98, 110, "Selfie time", "Selfie joyeux avec Kay, Choco et les amis, filtres fun et ambiance réseaux sociaux."],
    [110, 123, "Saut dans l'eau", "Saut groupé dans la piscine naturelle, ralenti cinématique et gouttelettes suspendues."],
    [123, 137, "Tous ensemble", "Danse finale avec tous les personnages, énergie maximale et couleurs explosives."],
    [137, durationSeconds, "Outro — Dour Playa", "Coucher de soleil sur Dour, mascottes face à l'horizon et apparition finale DOUR PLAYA."],
  ];

  const dna = [
    "Style 3D Pixar/Disney",
    "Ambiance tropicale festive",
    "Mascottes colorées cohérentes",
    "Kiosque de Dour, jets d'eau, palmiers, toboggan, tour rouge et lettres DOUR",
    "Lumière chaude, couleurs vives, rendu ultra net, mouvements caméra fluides",
    stylePrompt,
  ].filter(Boolean).join(". ");

  const clips = ranges.map(([start, end, title, intent], index) => ({
    id: index + 1,
    title,
    timecode: `${secondsToTimecode(start)} - ${secondsToTimecode(end)}`,
    start,
    end,
    duration: Math.max(1, end - start),
    format,
    intent,
    prompt: `Génère une vidéo ${format} de ${Math.max(1, end - start)} secondes pour le clip ${index + 1} de Dour Playa. ${dna}. Scène : ${intent} Caméra dynamique, profondeur de champ, détails riches, rendu propre, aucun texte illisible, aucune déformation des personnages.`,
    negativePrompt: "personnages déformés, mauvais logo, texte illisible, ambiance sombre, style réaliste froid, éléments parasites, low quality, flou, flicker excessif",
    transition: index === ranges.length - 1 ? "Fondu final chaud vers le logo Dour Playa." : "Transition fluide sur le rythme vers la séquence suivante.",
  }));

  return { durationSeconds, format, dna, clips };
}

app.get("/health", async (req, res) => {
  const [comfyui, ollama, ffmpeg] = await Promise.all([
    probeJson(`${COMFYUI_URL}/system_stats`),
    probeJson(`${OLLAMA_URL}/api/tags`),
    probeFfmpeg(),
  ]);

  res.json(ok({
    agent: {
      online: true,
      name: "JS-Innov.IA Local Agent",
      version: "0.1.0",
      port: PORT,
      projectsPath: LOCAL_PROJECTS_PATH,
    },
    services: {
      comfyui: { url: COMFYUI_URL, ...comfyui },
      ollama: { url: OLLAMA_URL, ...ollama },
      ffmpeg,
    },
  }));
});

app.post("/projects/create", async (req, res, next) => {
  try {
    const name = sanitizeSegment(req.body?.name || "Projet IA");
    const basePath = req.body?.basePath || LOCAL_PROJECTS_PATH;
    const projectPath = path.join(basePath, name);
    const folders = [
      "00_ADN_VISUEL",
      "01_AUDIO",
      "02_STORYBOARD",
      "03_PROMPTS",
      "04_CLIPS_GENERES",
      "05_MONTAGE_FINAL",
      "06_WORKFLOWS_COMFYUI",
      "07_EXPORTS_RESEAUX",
    ];

    await fs.mkdir(projectPath, { recursive: true });
    await Promise.all(folders.map((folder) => fs.mkdir(path.join(projectPath, folder), { recursive: true })));

    const readme = `# ${name}\n\nProjet IA local créé par JS-Innov.IA Local Agent.\n\n## Dossiers\n\n${folders.map((folder) => `- ${folder}`).join("\n")}\n\n## Pipeline conseillé\n\n1. Placer la planche ADN dans 00_ADN_VISUEL.\n2. Placer l'audio final dans 01_AUDIO.\n3. Placer le storyboard dans 02_STORYBOARD.\n4. Générer les prompts dans 03_PROMPTS.\n5. Générer les clips dans 04_CLIPS_GENERES.\n6. Assembler le montage final dans 05_MONTAGE_FINAL.\n`;
    await fs.writeFile(path.join(projectPath, "README_PROJET.md"), readme, "utf8");

    res.json(ok({ projectPath, folders }));
  } catch (error) {
    next(error);
  }
});

app.post("/prompts/dour-playa-plan", (req, res) => {
  const durationSeconds = Number(req.body?.durationSeconds || 146);
  const format = req.body?.format || "9:16";
  const stylePrompt = req.body?.stylePrompt || "";
  res.json(ok(buildDourPlayaPlan({ durationSeconds, format, stylePrompt })));
});

app.post("/ollama/generate", async (req, res, next) => {
  try {
    const model = req.body?.model || "llama3.1";
    const prompt = req.body?.prompt;
    if (!prompt) throw fail("Le champ prompt est obligatoire.", 400);

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    const payload = await response.json();
    if (!response.ok) throw fail(payload?.error || "Erreur Ollama", response.status);
    res.json(ok({ model, response: payload.response, raw: payload }));
  } catch (error) {
    next(error);
  }
});

app.post("/comfy/prompt", async (req, res, next) => {
  try {
    const workflow = req.body?.workflow;
    if (!workflow || typeof workflow !== "object") throw fail("Le workflow ComfyUI JSON est obligatoire.", 400);

    const response = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: req.body?.client_id || crypto.randomUUID() }),
    });

    const payload = await response.json();
    if (!response.ok) throw fail(payload?.error || "Erreur ComfyUI", response.status);
    res.json(ok({ comfyui: payload }));
  } catch (error) {
    next(error);
  }
});

app.post("/video/assemble", async (req, res, next) => {
  try {
    const clips = Array.isArray(req.body?.clips) ? req.body.clips.filter(Boolean) : [];
    const audioPath = req.body?.audioPath;
    const outputPath = req.body?.outputPath;

    if (clips.length === 0) throw fail("La liste clips est obligatoire.", 400);
    if (!outputPath) throw fail("Le champ outputPath est obligatoire.", 400);

    const concatFile = path.join(os.tmpdir(), `jsinnovia-concat-${Date.now()}.txt`);
    const concatContent = clips.map((clip) => `file '${toPosixForFfmpeg(clip)}'`).join("\n");
    await fs.writeFile(concatFile, concatContent, "utf8");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatFile];
    if (audioPath) args.push("-i", audioPath);
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
    if (audioPath) args.push("-c:a", "aac", "-shortest");
    args.push(outputPath);

    const { stdout, stderr } = await execFileAsync("ffmpeg", args, { timeout: 1000 * 60 * 30 });
    res.json(ok({ outputPath, stdout, stderr }));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({ ok: false, error: error.message || "Erreur agent local" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`JS-Innov.IA Local Agent lancé sur http://127.0.0.1:${PORT}`);
  console.log(`ComfyUI: ${COMFYUI_URL}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log(`Projects: ${LOCAL_PROJECTS_PATH}`);
});
