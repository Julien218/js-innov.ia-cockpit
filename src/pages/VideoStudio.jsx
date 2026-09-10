import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import TimelineEditor from "../components/studio/TimelineEditor";
import VideoPreview from "../components/studio/VideoPreview";
import StudioSidebar from "../components/studio/StudioSidebar";
import AiPromptPanel from "../components/studio/AiPromptPanel";
import AgentMonteur from "../components/studio/AgentMonteur";
import VideoExporter from "../components/studio/VideoExporter";
import MultiTrackTimeline from "../components/studio/MultiTrackTimeline";
import MultiTrackExporter from "../components/studio/MultiTrackExporter";
import SocialExporter from "../components/studio/SocialExporter";
import VideoModeToggle from "../components/studio/VideoModeToggle";
import VideoOrchestratorPanel from "../components/studio/VideoOrchestratorPanel";
import { VIDEO_MODES, buildLocalMontagePlan, buildVideoPromptLocally, getVideoMode } from "@/lib/videoOrchestrator";
import { downloadBlob } from "@/lib/fileDownload";
import { consumeMusicMotionHandoff } from "@/lib/musicMotionHandoff";
import { ArrowLeft, Sparkles, Upload, Download, Save, Film, RefreshCw, Layers, Smartphone } from "lucide-react";

const TRANSITIONS = [
  { id: "fade", label: "Fondu", icon: "🌅" },
  { id: "slide", label: "Glissé", icon: "➡️" },
  { id: "zoom", label: "Zoom", icon: "🔍" },
  { id: "flash", label: "Flash", icon: "⚡" },
  { id: "blur", label: "Blur", icon: "🌫️" },
  { id: "wipe", label: "Wipe", icon: "🪟" },
  { id: "glitch", label: "Glitch", icon: "📺" },
];

const createVideoProject = (project = {}) => {
  const safeProject = project && typeof project === "object" ? project : {};
  return {
    title: "Nouveau montage",
    audio_url: "",
    audio_name: "",
    audio_duration_seconds: 0,
    transition: "fade",
    status: "draft",
    ...safeProject,
    clips: Array.isArray(safeProject.clips) ? safeProject.clips : [],
    texts: Array.isArray(safeProject.texts) ? safeProject.texts : [],
  };
};

const getErrorMessage = (error, fallback) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
};

const isBlobUrl = (value) => String(value || "").startsWith("blob:");

const uploadedFileUrl = (uploaded, label) => {
  const url = uploaded?.file_url || uploaded?.url;
  if (!url) throw new Error("Le serveur n’a pas renvoyé l’URL " + label + ".");
  return url;
};

export default function VideoStudio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vp, setVp] = useState(() => createVideoProject());
  const [sourceProject, setSourceProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [studioError, setStudioError] = useState("");
  const [activePanel, setActivePanel] = useState("timeline");
  const [driveStatus, setDriveStatus] = useState(null);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentClipIdx, setCurrentClipIdx] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showExporter, setShowExporter] = useState(false);
  const [showMultiExporter, setShowMultiExporter] = useState(false);
  const [showSocialExporter, setShowSocialExporter] = useState(false);
  const [tracks, setTracks] = useState(null);
  const [videoMode, setVideoMode] = useState(getVideoMode);
  const [pendingHandoff, setPendingHandoff] = useState(null);
  const initializedRouteRef = useRef("");

  useEffect(() => {
    const routeKey = id || "new";
    if (initializedRouteRef.current === routeKey) return;
    initializedRouteRef.current = routeKey;
    setLoading(true);
    setStudioError("");

    if (id && id !== "new") {
      base44.entities.VideoProject.filter({ id }).then(([found]) => {
        if (found) {
          const normalized = createVideoProject(found);
          setVp(normalized);
          setTracks(normalized.template_tracks || null);
          if (normalized.project_id) {
            base44.entities.Project.filter({ id: normalized.project_id }).then(([p]) => {
              setSourceProject(p || null);
              setLoading(false);
            }).catch((error) => {
              setSourceProject(null);
              setStudioError(`Montage chargé, mais le projet source est indisponible : ${getErrorMessage(error, "erreur inconnue")}`);
              setLoading(false);
            });
          } else {
            setSourceProject(null);
            setLoading(false);
          }
        } else {
          initNew(true);
        }
      }).catch((error) => {
        setVp(createVideoProject());
        setTracks(null);
        setSourceProject(null);
        setStudioError(`Impossible de charger ce montage. Un montage vide a été ouvert : ${getErrorMessage(error, "erreur inconnue")}`);
        setLoading(false);
      });
    } else {
      initNew(false);
    }
  }, [id]);

  const initNew = (missingRequestedProject = false) => {
    const handoff = consumeMusicMotionHandoff();
    if (handoff?.audioFile) {
      const audioPreviewUrl = URL.createObjectURL(handoff.audioFile);
      const references = (Array.isArray(handoff.references) ? handoff.references : [])
        .filter((reference) => reference?.file && typeof reference.file.arrayBuffer === "function");
      const clips = references.map((reference, index) => ({
        id: "clip_music_motion_" + index,
        url: URL.createObjectURL(reference.file),
        name: reference.name || "Référence " + (index + 1),
        type: "image",
        duration: 4,
        transition: "fade",
        source_reference_id: reference.id,
      }));
      setPendingHandoff({
        ...handoff,
        previewAudioUrl: audioPreviewUrl,
        previewReferenceUrls: clips.map((clip) => clip.url),
      });
      setSourceProject(null);
      setTracks(null);
      setVp(createVideoProject({
        title: handoff.title || handoff.audioFile.name || "Nouveau montage",
        audio_url: audioPreviewUrl,
        audio_name: handoff.audioFile.name || "musique",
        audio_duration_seconds: Number(handoff.duration) || 0,
        ai_prompt: handoff.aiPrompt || "",
        clips,
        metadata: {
          handoff_version: 1,
          music_motion: handoff.metadata || null,
        },
      }));
      setLoading(false);
      return;
    }

    const search = new URLSearchParams(window.location.search);
    const projectId = search.get("project");
    if (projectId) {
      base44.entities.Project.filter({ id: projectId }).then(([p]) => {
        setSourceProject(p || null);
        setTracks(null);
        const artworkImages = Array.isArray(p?.artworks_images) ? p.artworks_images : [];
        const clips = artworkImages.map((url, i) => ({
          id: `clip_${i}`,
          url,
          name: `Image ${i + 1}`,
          type: "image",
          duration: 4,
          transition: "fade",
        }));
        setVp(createVideoProject({
          title: p?.project_name || "Nouveau montage",
          project_id: projectId,
          clips,
        }));
        setLoading(false);
      }).catch((error) => {
        setSourceProject(null);
        setTracks(null);
        setVp(createVideoProject({ project_id: projectId }));
        setStudioError(`Le projet source est indisponible. Un montage vide a été ouvert : ${getErrorMessage(error, "erreur inconnue")}`);
        setLoading(false);
      });
    } else {
      setSourceProject(null);
      setTracks(null);
      setVp(createVideoProject());
      if (missingRequestedProject) {
        setStudioError("Le montage demandé n’existe plus ou n’est pas accessible. Un nouveau montage vide a été ouvert.");
      }
      setLoading(false);
    }
  };

  const update = (key, val) => {
    setVp((current) => createVideoProject({ ...createVideoProject(current), [key]: val }));
  };

  useEffect(() => () => {
    if (pendingHandoff?.previewAudioUrl) URL.revokeObjectURL(pendingHandoff.previewAudioUrl);
    (pendingHandoff?.previewReferenceUrls || []).forEach((url) => URL.revokeObjectURL(url));
  }, [pendingHandoff]);

  const preparePendingHandoff = async (payload) => {
    if (!pendingHandoff) return payload;
    const prepared = { ...payload };
    if (pendingHandoff.audioFile && isBlobUrl(prepared.audio_url)) {
      const uploaded = await base44.integrations.Core.UploadFile({ file: pendingHandoff.audioFile });
      prepared.audio_url = uploadedFileUrl(uploaded, "audio");
      prepared.audio_name = pendingHandoff.audioFile.name || prepared.audio_name;
    }

    const references = new Map(
      (pendingHandoff.references || []).map((reference) => [reference.id, reference]),
    );
    const uploadedReferences = new Map();
    const preparedClips = [];
    for (const clip of Array.isArray(prepared.clips) ? prepared.clips : []) {
      const reference = references.get(clip.source_reference_id);
      if (!reference?.file || !isBlobUrl(clip.url)) {
        preparedClips.push(clip);
        continue;
      }
      let fileUrl = uploadedReferences.get(reference.id);
      if (!fileUrl) {
        const uploaded = await base44.integrations.Core.UploadFile({ file: reference.file });
        fileUrl = uploadedFileUrl(uploaded, "de la référence");
        uploadedReferences.set(reference.id, fileUrl);
      }
      preparedClips.push({ ...clip, url: fileUrl });
    }
    prepared.clips = preparedClips;
    return prepared;
  };

  const reloadVp = useCallback(async () => {
    if (!vp?.id) {
      setStudioError("Enregistrez d’abord ce nouveau montage avant de le synchroniser.");
      return;
    }
    try {
      const [fresh] = await base44.entities.VideoProject.filter({ id: vp.id });
      if (!fresh) {
        throw new Error("Le montage n’a pas été retrouvé dans la base.");
      }
      setVp(createVideoProject(fresh));
      setStudioError("");
    } catch (error) {
      setStudioError(`Synchronisation impossible : ${getErrorMessage(error, "erreur inconnue")}`);
    }
  }, [vp?.id]);

  useEffect(() => {
    if (!vp?.id || typeof base44.entities.VideoProject.subscribe !== "function") return undefined;
    const unsub = base44.entities.VideoProject.subscribe((event) => {
      if (event.id === vp.id && event.type === "update" && event.data) {
        setVp((previous) => createVideoProject({
          ...createVideoProject(previous),
          ...event.data,
          clips: Array.isArray(event.data.clips) ? event.data.clips : createVideoProject(previous).clips,
          ai_prompt: event.data.ai_prompt || createVideoProject(previous).ai_prompt,
        }));
      }
    });
    return () => unsub?.();
  }, [vp?.id]);

  const handleSave = async () => {
    setSaving(true);
    setStudioError("");
    try {
      const payload = await preparePendingHandoff(createVideoProject(vp));
      setVp(createVideoProject(payload));
      if (payload.id) {
        const updated = await base44.entities.VideoProject.update(payload.id, payload);
        if (!updated || typeof updated !== "object") {
          throw new Error("La base n’a renvoyé aucun montage après la mise à jour.");
        }
        setVp(createVideoProject(updated));
        setPendingHandoff(null);
      } else {
        const created = await base44.entities.VideoProject.create(payload);
        if (!created?.id) {
          throw new Error("La base n’a pas confirmé la création du montage.");
        }
        setVp(createVideoProject(created));
        setPendingHandoff(null);
        navigate(`/video-studio/${created.id}`, { replace: true });
      }
    } catch (error) {
      setStudioError(`Sauvegarde impossible : ${getErrorMessage(error, "erreur inconnue")}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOptimizeMontage = async () => {
    const currentProject = createVideoProject(vp);
    const plan = buildLocalMontagePlan(currentProject, sourceProject, "tempo_sync_editor");
    setVp((current) => createVideoProject({ ...createVideoProject(current), clips: plan.clips }));
    if (currentProject.id) {
      await base44.entities.VideoProject.update(currentProject.id, { clips: plan.clips });
    }
    return plan;
  };

  const handleGeneratePrompt = async () => {
    setGeneratingPrompt(true);
    setActivePanel("ai");
    try {
      const currentProject = createVideoProject(vp);
      if (videoMode === VIDEO_MODES.LOCAL || !base44.functions?.invoke) {
        update("ai_prompt", buildVideoPromptLocally(currentProject, sourceProject));
        return;
      }
      const res = await base44.functions.invoke("generateVideoPrompt", { videoProject: currentProject, sourceProject });
      update("ai_prompt", res.data.prompt);
    } catch (error) {
      setStudioError(`Génération du prompt impossible : ${getErrorMessage(error, "erreur inconnue")}`);
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleUploadDrive = async () => {
    setActivePanel("drive");
    const currentProject = createVideoProject(vp);
    if (!currentProject.ai_prompt) {
      setStudioError("Générez d’abord le prompt IA avant l’envoi vers Drive.");
      return;
    }
    if (!base44.functions?.invoke) {
      try {
        const content = `JS-INNOV.IA VIDEO DEMO BUILDER — ${currentProject.title}\n${"=".repeat(60)}\n\n${currentProject.ai_prompt}`;
        downloadBlob(
          new Blob([content], { type: "text/plain;charset=utf-8" }),
          `${currentProject.title.replace(/\s+/g, "_")}_MONTAGE_PROMPT.txt`,
        );
        setDriveStatus({ localDownload: true });
        setStudioError("");
      } catch (error) {
        setStudioError(`Export local impossible : ${getErrorMessage(error, "erreur inconnue")}`);
      }
      return;
    }
    setUploading(true);
    setActivePanel("drive");
    try {
      const content = `JS-INNOV.IA VIDEO DEMO BUILDER — ${currentProject.title}\n${"=".repeat(60)}\n\n${currentProject.ai_prompt}`;
      const res = await base44.functions.invoke("uploadToDrive", {
        fileName: `${currentProject.title.replace(/\s+/g, "_")}_MONTAGE_PROMPT.txt`,
        fileContent: content,
        mimeType: "text/plain",
      });
      const { driveUrl, fileId, folderId } = res.data;
      update("drive_url", driveUrl);
      update("drive_file_id", fileId);
      update("status", "uploaded");
      setDriveStatus({ driveUrl, fileId, folderId });
      setStudioError("");
    } catch (error) {
      setStudioError(`Envoi vers Drive impossible : ${getErrorMessage(error, "erreur inconnue")}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = () => {
    const currentProject = createVideoProject(vp);
    if (!currentProject.ai_prompt) {
      setStudioError("Générez d’abord le prompt IA avant de le télécharger.");
      return;
    }
    const content = `JS-INNOV.IA VIDEO DEMO BUILDER — ${currentProject.title}\n${"=".repeat(60)}\n\n${currentProject.ai_prompt}`;
    try {
      downloadBlob(
        new Blob([content], { type: "text/plain;charset=utf-8" }),
        `${currentProject.title.replace(/\s+/g, "_")}_PROMPT.txt`,
      );
      setStudioError("");
    } catch (error) {
      setStudioError(`Téléchargement du prompt impossible : ${getErrorMessage(error, "erreur inconnue")}`);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const currentVp = createVideoProject(vp);
  const clipsDuration = currentVp.clips.reduce((sum, clip) => sum + (clip?.duration || 4), 0);
  const audioDuration = Number(currentVp.audio_duration_seconds) || 0;
  const totalDuration = Math.max(clipsDuration, audioDuration);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <input
              value={currentVp.title}
              onChange={e => update("title", e.target.value)}
              className="font-display font-semibold text-foreground text-base bg-transparent border-none outline-none focus:ring-0 w-64"
            />
            <p className="text-xs text-muted-foreground">Studio · {currentVp.clips.length} clips · {totalDuration}s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VideoModeToggle
            onChange={(nextMode) => {
              setVideoMode(nextMode);
              if (nextMode === VIDEO_MODES.LOCAL && activePanel === "agent") setActivePanel("orchestrator");
            }}
          />
          <button onClick={reloadVp} title="Rafraîchir depuis la base" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw size={13} />
            Sync
          </button>
          {tracks && (
            <button onClick={() => setShowMultiExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg btn-gold text-xs font-medium">
              <Layers size={13} />
              Export multipiste
            </button>
          )}
          {currentVp.template_format && (
            <button onClick={() => setShowSocialExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-primary border-primary/30 hover:bg-primary/10 transition-all">
              <Smartphone size={13} />
              Export {currentVp.template_format}
            </button>
          )}
          <button onClick={() => setShowExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all">
            <Film size={13} />
            Export simple
          </button>
          <button onClick={handleGeneratePrompt} disabled={generatingPrompt} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50">
            <Sparkles size={13} className={generatingPrompt ? "animate-spin" : ""} />
            {generatingPrompt ? "Génération…" : videoMode === VIDEO_MODES.LOCAL ? "Prompt LOCAL" : "Prompt IA"}
          </button>
          <button onClick={handleUploadDrive} disabled={uploading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all disabled:opacity-50">
            <Upload size={13} />
            {uploading ? "Upload…" : "Drive"}
          </button>
          <button onClick={handleDownload} title="Télécharger le prompt IA" aria-label="Télécharger le prompt IA" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all">
            <Download size={13} />
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-gold flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs">
            <Save size={13} />
            {saving ? "…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      {studioError && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-4">
          <span>{studioError}</span>
          <button type="button" onClick={() => setStudioError("")} className="text-amber-100 hover:text-white" aria-label="Fermer le message">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <StudioSidebar vp={currentVp} update={update} transitions={TRANSITIONS} sourceProject={sourceProject} />

        <div className="flex flex-col flex-1 overflow-hidden">
          <VideoPreview
            clips={currentVp.clips}
            texts={currentVp.texts}
            transition={currentVp.transition}
            audioUrl={currentVp.audio_url}
            audioDuration={currentVp.audio_duration_seconds}
            currentClipIdx={currentClipIdx}
            onClipChange={setCurrentClipIdx}
          />

          <div className="border-t border-border flex shrink-0">
            {[
              { id: "timeline", label: "Timeline" },
              ...(tracks ? [{ id: "multitrack", label: "🎚️ Multipiste" }] : []),
              { id: "ai", label: videoMode === VIDEO_MODES.LOCAL ? "Prompt LOCAL" : "🤖 Prompt IA" },
              { id: "orchestrator", label: videoMode === VIDEO_MODES.LOCAL ? "Agent Vidéo LOCAL" : "Agent Vidéo" },
              ...(videoMode === VIDEO_MODES.API ? [{ id: "agent", label: "🎬 Agent Monteur API" }] : []),
              { id: "drive", label: "☁️ Drive" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActivePanel(t.id)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${activePanel === t.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto bg-muted/30">
            {activePanel === "multitrack" && tracks && (
              <div className="h-64">
                <MultiTrackTimeline
                  tracks={tracks}
                  onTracksChange={(newTracks) => {
                    setTracks(newTracks);
                    update("template_tracks", newTracks);
                  }}
                  currentTime={currentTime}
                  onSeek={setCurrentTime}
                  duration={currentVp.template_duration || 30}
                />
              </div>
            )}
            {activePanel === "timeline" && (
              <TimelineEditor
                clips={currentVp.clips}
                onChange={(clips) => update("clips", clips)}
                transition={currentVp.transition}
                transitions={TRANSITIONS}
                onGlobalTransition={(transition) => update("transition", transition)}
                currentClipIdx={currentClipIdx}
                onSelect={setCurrentClipIdx}
              />
            )}
            {activePanel === "ai" && (
              <AiPromptPanel
                prompt={currentVp.ai_prompt}
                loading={generatingPrompt}
                onGenerate={handleGeneratePrompt}
                onUpdate={(prompt) => update("ai_prompt", prompt)}
              />
            )}
            {activePanel === "orchestrator" && (
              <VideoOrchestratorPanel vp={currentVp} onOptimizeMontage={handleOptimizeMontage} />
            )}
            {activePanel === "agent" && videoMode === VIDEO_MODES.API && (
              <AgentMonteur
                vp={currentVp}
                sourceProject={sourceProject}
                onAgentUpdated={reloadVp}
                onRenderReady={(result) => {
                  if (result.driveUrl) update("drive_url", result.driveUrl);
                  if (result.driveFileId) update("drive_file_id", result.driveFileId);
                  update("status", "ready");
                }}
              />
            )}
            {activePanel === "drive" && (
              <div className="p-5 space-y-4">
                <h3 className="font-display text-sm font-semibold gold-text">Google Drive</h3>
                {driveStatus?.localDownload && !currentVp.drive_url && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    Prompt téléchargé sur ce poste. La connexion Google Drive n’est pas configurée sur ce Cockpit.
                  </div>
                )}
                {currentVp.drive_url ? (
                  <div className="card-premium rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-green-400">
                      <span>✅</span>
                      <span className="text-sm font-medium">Fichier uploadé avec succès</span>
                    </div>
                    <a href={currentVp.drive_url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-primary underline break-all">{currentVp.drive_url}</a>
                    <button onClick={handleUploadDrive} disabled={uploading} className="text-xs text-muted-foreground hover:text-foreground">
                      Mettre à jour →
                    </button>
                  </div>
                ) : (
                  <div className="card-premium rounded-xl p-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">Aucun fichier sur Drive pour ce montage.</p>
                    <button onClick={handleUploadDrive} disabled={uploading} className="btn-gold px-5 py-2 rounded-lg text-sm">
                      <Upload size={13} className="inline mr-1.5" />
                      {uploading ? "Upload en cours…" : "Uploader le prompt sur Drive"}
                    </button>
                  </div>
                )}
                {driveStatus?.driveUrl && !currentVp.drive_url && (
                  <a href={driveStatus.driveUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">
                    {driveStatus.driveUrl}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showExporter && (
        <VideoExporter
          vp={currentVp}
          sourceProject={sourceProject}
          onClose={() => setShowExporter(false)}
        />
      )}
      {showMultiExporter && tracks && (
        <MultiTrackExporter
          vp={currentVp}
          tracks={tracks}
          sourceProject={sourceProject}
          onClose={() => setShowMultiExporter(false)}
        />
      )}
      {showSocialExporter && (
        <SocialExporter
          vp={currentVp}
          sourceProject={sourceProject}
          onClose={() => setShowSocialExporter(false)}
        />
      )}
    </div>
  );
}
