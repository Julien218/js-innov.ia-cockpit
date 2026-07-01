import React, { useEffect, useMemo, useState } from "react";
import {
  Cpu,
  Film,
  FolderPlus,
  RefreshCw,
  Server,
  Sparkles,
  TerminalSquare,
  Wand2,
} from "lucide-react";
import { localAiClient, getLocalAgentUrl, setLocalAgentUrl } from "@/services/localAiClient";

const DEFAULT_PROJECT_PATH = "C:\\Users\\PC User\\Documents\\Js-Innov.IA";

function StatusPill({ label, status }) {
  const normalized = status === true || status === "online" ? "online" : "offline";
  return (
    <div className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{normalized === "online" ? "Connecté" : "Non détecté"}</p>
      </div>
      <span className={`h-3 w-3 rounded-full ${normalized === "online" ? "bg-emerald-500" : "bg-red-500"}`} />
    </div>
  );
}

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function LocalAI() {
  const [agentUrl, setAgentUrl] = useState(getLocalAgentUrl());
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("Dour Playa");
  const [basePath, setBasePath] = useState(DEFAULT_PROJECT_PATH);
  const [projectResult, setProjectResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");

  const isAgentOnline = useMemo(() => Boolean(health?.agent?.online), [health]);

  const saveAgentUrl = () => {
    setLocalAgentUrl(agentUrl);
    refreshHealth();
  };

  const refreshHealth = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await localAiClient.health();
      setHealth(result);
    } catch (err) {
      setHealth(null);
      setError(err.message || "Agent local non joignable");
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await localAiClient.createProject({ name: projectName, basePath });
      setProjectResult(result);
    } catch (err) {
      setError(err.message || "Création du projet impossible");
    } finally {
      setLoading(false);
    }
  };

  const generateDourPlayaPlan = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await localAiClient.generateDourPlayaPlan({
        durationSeconds: 146,
        format: "9:16",
        stylePrompt: "ADN officiel Dour Playa : style 3D Pixar/Disney, tropical, festif, mascottes, kiosque, jets d'eau, toboggan, tour rouge, lettres DOUR.",
      });
      setPlan(result);
    } catch (err) {
      setError(err.message || "Génération du plan impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/80">
              <Cpu className="h-4 w-4" /> Centre IA locale
            </div>
            <h1 className="text-3xl font-black tracking-tight">IA Locale JS-Innov.IA</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/70">
              Pilote ComfyUI, Ollama et FFmpeg depuis le cockpit pour générer des images, des clips image-to-video,
              des prompts Dour Playa et des exports vidéo directement depuis ton PC.
            </p>
          </div>
          <button
            onClick={refreshHealth}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-white/90 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Tester la connexion
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatusPill label="Agent local" status={health?.agent?.online} />
        <StatusPill label="ComfyUI" status={health?.services?.comfyui?.online} />
        <StatusPill label="Ollama" status={health?.services?.ollama?.online} />
        <StatusPill label="FFmpeg" status={health?.services?.ffmpeg?.online} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          icon={Server}
          title="Connexion à l'agent local"
          description="L'interface cockpit communique avec un petit serveur local Node.js lancé sur ton PC."
        >
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-foreground">URL agent local</label>
            <div className="flex gap-2">
              <input
                value={agentUrl}
                onChange={(event) => setAgentUrl(event.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="http://127.0.0.1:8787"
              />
              <button onClick={saveAgentUrl} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">
                Sauver
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Statut actuel : {isAgentOnline ? "agent détecté" : "agent non lancé ou port inaccessible"}.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          icon={FolderPlus}
          title="Créer un projet local"
          description="Prépare automatiquement les dossiers ADN, audio, prompts, clips, montage final et exports."
        >
          <div className="space-y-3">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="Nom du projet"
            />
            <input
              value={basePath}
              onChange={(event) => setBasePath(event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="Chemin local parent"
            />
            <button onClick={createProject} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              <FolderPlus className="h-4 w-4" /> Créer l'arborescence
            </button>
            {projectResult?.projectPath && (
              <div className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                Projet créé : <span className="font-semibold text-foreground">{projectResult.projectPath}</span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          icon={Wand2}
          title="Plan vidéo Dour Playa"
          description="Génère le découpage de référence pour clips de 10 à 15 secondes sur 2 min 26."
        >
          <button onClick={generateDourPlayaPlan} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <Sparkles className="h-4 w-4" /> Générer le plan Dour Playa
          </button>
          {plan?.clips?.length > 0 && (
            <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
              {plan.clips.map((clip) => (
                <div key={clip.id} className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-sm font-bold text-foreground">{clip.id}. {clip.title}</p>
                  <p className="text-xs font-semibold text-primary">{clip.timecode}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{clip.intent}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Film}
          title="Pipeline créatif local"
          description="Étapes prévues pour image, image-to-video, upscale et assemblage final."
        >
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-xl border p-3"><strong className="text-foreground">1.</strong> Image ADN + storyboard dans le dossier projet.</div>
            <div className="rounded-xl border p-3"><strong className="text-foreground">2.</strong> Prompt scène généré par Ollama ou par le plan Dour Playa.</div>
            <div className="rounded-xl border p-3"><strong className="text-foreground">3.</strong> Workflow ComfyUI pour image-to-video.</div>
            <div className="rounded-xl border p-3"><strong className="text-foreground">4.</strong> Assemblage FFmpeg avec l'audio final.</div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        icon={TerminalSquare}
        title="Commande de lancement local"
        description="À exécuter sur le PC où ComfyUI, Ollama et FFmpeg sont installés."
      >
        <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
{`cd "C:\\Users\\PC User\\Documents\\Js-Innov.IA\\js-innov.ia-cockpit"
npm run local-agent`}
        </pre>
      </SectionCard>
    </div>
  );
}
