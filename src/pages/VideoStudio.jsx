import { useState, useEffect, useCallback } from "react";
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

export default function VideoStudio() {
  const { id } = useParams(); // optional: videoProjectId
  const navigate = useNavigate();
  const [vp, setVp] = useState(null); // VideoProject
  const [sourceProject, setSourceProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePanel, setActivePanel] = useState("timeline"); // timeline | ai | drive
  const [driveStatus, setDriveStatus] = useState(null);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentClipIdx, setCurrentClipIdx] = useState(0);
  const [showExporter, setShowExporter] = useState(false);
  const [showMultiExporter, setShowMultiExporter] = useState(false);
  const [showSocialExporter, setShowSocialExporter] = useState(false);
  const [tracks, setTracks] = useState(null); // multipiste, null = non activé

  useEffect(() => {
    if (id && id !== "new") {
      base44.entities.VideoProject.filter({ id }).then(([found]) => {
        if (found) {
          setVp(found);
          // Restore multipiste tracks if template was used
          if (found.template_tracks) setTracks(found.template_tracks);
          if (found.project_id) {
            base44.entities.Project.filter({ id: found.project_id }).then(([p]) => {
              setSourceProject(p || null);
              setLoading(false);
            });
          } else setLoading(false);
        } else initNew();
      });
    } else {
      initNew();
    }
  }, [id]);

  const initNew = () => {
    const search = new URLSearchParams(window.location.search);
    const projectId = search.get("project");
    if (projectId) {
      base44.entities.Project.filter({ id: projectId }).then(([p]) => {
        setSourceProject(p || null);
        const vpTracks = null; // standard mode by default
        setTracks(vpTracks);
        const clips = (p?.artworks_images || []).map((url, i) => ({
          id: `clip_${i}`,
          url,
          name: `Image ${i + 1}`,
          type: "image",
          duration: 4,
          transition: "fade",
        }));
        setVp({
          title: p?.project_name || "Nouveau montage",
          project_id: projectId,
          clips,
          audio_url: "",
          audio_name: "",
          texts: [],
          transition: "fade",
          status: "draft",
        });
        setLoading(false);
      });
    } else if (id && id !== "new") {
      // loaded from db — check for template_tracks
      // handled by useEffect above
    } else {
      setVp({
        title: "Nouveau montage",
        clips: [],
        audio_url: "",
        audio_name: "",
        texts: [],
        transition: "fade",
        status: "draft",
      });
      setLoading(false);
    }
  };

  const update = (key, val) => setVp((v) => ({ ...v, [key]: val }));

  // Recharge le VideoProject depuis la base (utilisé après que l'agent l'a mis à jour)
  const reloadVp = useCallback(async () => {
    if (!vp?.id) return;
    const [fresh] = await base44.entities.VideoProject.filter({ id: vp.id });
    if (fresh) setVp(fresh);
  }, [vp?.id]);

  // Subscription temps réel : dès que l'agent met à jour le VideoProject en base, on recharge
  useEffect(() => {
    if (!vp?.id) return;
    const unsub = base44.entities.VideoProject.subscribe((event) => {
      if (event.id === vp.id && (event.type === "update")) {
        // Recharge seulement les clips et transitions (pas écraser les edits locaux)
        if (event.data?.clips) {
          setVp((prev) => ({ ...prev, clips: event.data.clips, ai_prompt: event.data.ai_prompt || prev.ai_prompt }));
        }
      }
    });
    return () => unsub();
  }, [vp?.id]);

  const handleSave = async () => {
    setSaving(true);
    if (vp.id) {
      const updated = await base44.entities.VideoProject.update(vp.id, vp);
      setVp(updated);
    } else {
      const created = await base44.entities.VideoProject.create(vp);
      setVp(created);
      navigate(`/studio/${created.id}`, { replace: true });
    }
    setSaving(false);
  };

  const handleGeneratePrompt = async () => {
    setGeneratingPrompt(true);
    setActivePanel("ai");
    const res = await base44.functions.invoke("generateVideoPrompt", { videoProject: vp, sourceProject });
    update("ai_prompt", res.data.prompt);
    setGeneratingPrompt(false);
  };

  const handleUploadDrive = async () => {
    if (!vp.ai_prompt) {
      alert("Générez d'abord le prompt IA pour uploader sur Drive.");
      return;
    }
    setUploading(true);
    setActivePanel("drive");
    const content = `JS-INNOV.IA VIDEO DEMO BUILDER — ${vp.title}\n${"=".repeat(60)}\n\n${vp.ai_prompt}`;
    const res = await base44.functions.invoke("uploadToDrive", {
      fileName: `${vp.title.replace(/\s+/g, "_")}_MONTAGE_PROMPT.txt`,
      fileContent: content,
      mimeType: "text/plain",
    });
    const { driveUrl, fileId, folderId } = res.data;
    update("drive_url", driveUrl);
    update("drive_file_id", fileId);
    update("status", "uploaded");
    setDriveStatus({ driveUrl, fileId, folderId });
    setUploading(false);
  };

  const handleDownload = () => {
    if (!vp.ai_prompt) { alert("Générez d'abord le prompt IA."); return; }
    const content = `JS-INNOV.IA VIDEO DEMO BUILDER — ${vp.title}\n${"=".repeat(60)}\n\n${vp.ai_prompt}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vp.title.replace(/\s+/g, "_")}_PROMPT.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const totalDuration = (vp.clips || []).reduce((s, c) => s + (c.duration || 4), 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <input
              value={vp.title}
              onChange={e => update("title", e.target.value)}
              className="font-display font-semibold text-foreground text-base bg-transparent border-none outline-none focus:ring-0 w-64"
            />
            <p className="text-xs text-muted-foreground">Studio · {vp.clips?.length || 0} clips · {totalDuration}s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reloadVp} title="Rafraîchir depuis la base (après l'agent)" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw size={13} />
            Sync
          </button>
          {tracks && (
            <button onClick={() => setShowMultiExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg btn-gold text-xs font-medium">
              <Layers size={13} />
              Export multipiste
            </button>
          )}
          {vp?.template_format && (
            <button onClick={() => setShowSocialExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-primary border-primary/30 hover:bg-primary/10 transition-all">
              <Smartphone size={13} />
              Export {vp.template_format}
            </button>
          )}
          <button onClick={() => setShowExporter(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all">
            <Film size={13} />
            Export simple
          </button>
          <button onClick={handleGeneratePrompt} disabled={generatingPrompt} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50">
            <Sparkles size={13} className={generatingPrompt ? "animate-spin" : ""} />
            {generatingPrompt ? "Génération…" : "Prompt IA"}
          </button>
          <button onClick={handleUploadDrive} disabled={uploading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all disabled:opacity-50">
            <Upload size={13} />
            {uploading ? "Upload…" : "Drive"}
          </button>
          <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all">
            <Download size={13} />
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-gold flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs">
            <Save size={13} />
            {saving ? "…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <StudioSidebar vp={vp} update={update} transitions={TRANSITIONS} sourceProject={sourceProject} />

        {/* Center: Preview + Timeline */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Preview */}
          <VideoPreview
            clips={vp.clips || []}
            texts={vp.texts || []}
            transition={vp.transition}
            currentClipIdx={currentClipIdx}
            onClipChange={setCurrentClipIdx}
          />

          {/* Panel tabs */}
          <div className="border-t border-border flex shrink-0">
            {[
              { id: "timeline", label: "Timeline" },
              ...(tracks ? [{ id: "multitrack", label: "🎚️ Multipiste" }] : []),
              { id: "ai", label: "🤖 Prompt IA" },
              { id: "agent", label: "🎬 Agent Monteur" },
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

          {/* Panel content */}
          <div className="flex-1 overflow-auto bg-muted/30">
            {activePanel === "multitrack" && tracks && (
              <div className="h-64">
                <MultiTrackTimeline
                  tracks={tracks}
                  onTracksChange={(newTracks) => {
                    setTracks(newTracks);
                    update("template_tracks", newTracks);
                  }}
                  currentTime={0}
                  onSeek={() => {}}
                  duration={vp?.template_duration || 30}
                />
              </div>
            )}
            {activePanel === "timeline" && (
              <TimelineEditor
                clips={vp.clips || []}
                onChange={(clips) => update("clips", clips)}
                transition={vp.transition}
                transitions={TRANSITIONS}
                onGlobalTransition={(t) => update("transition", t)}
                currentClipIdx={currentClipIdx}
                onSelect={setCurrentClipIdx}
              />
            )}
            {activePanel === "ai" && (
              <AiPromptPanel
                prompt={vp.ai_prompt}
                loading={generatingPrompt}
                onGenerate={handleGeneratePrompt}
                onUpdate={(p) => update("ai_prompt", p)}
              />
            )}
            {activePanel === "agent" && (
              <AgentMonteur
                vp={vp}
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
                {vp.drive_url ? (
                  <div className="card-premium rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-green-400">
                      <span>✅</span>
                      <span className="text-sm font-medium">Fichier uploadé avec succès</span>
                    </div>
                    <a href={vp.drive_url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-primary underline break-all">{vp.drive_url}</a>
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
              </div>
            )}
          </div>
        </div>
      </div>
    {showExporter && (
      <VideoExporter
        vp={vp}
        sourceProject={sourceProject}
        onClose={() => setShowExporter(false)}
      />
    )}
    {showMultiExporter && tracks && (
      <MultiTrackExporter
        vp={vp}
        tracks={tracks}
        sourceProject={sourceProject}
        onClose={() => setShowMultiExporter(false)}
      />
    )}
    {showSocialExporter && (
      <SocialExporter
        vp={vp}
        sourceProject={sourceProject}
        onClose={() => setShowSocialExporter(false)}
      />
    )}
  </div>
  );
}
