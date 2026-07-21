import { useState, useRef, useEffect } from "react";
import { X, Download, Film, CheckCircle, AlertCircle } from "lucide-react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";

const FORMAT_PRESETS = {
  "9:16":  { width: 1080, height: 1920, label: "Vertical 9:16 (TikTok / Reels / Shorts)" },
  "1:1":   { width: 1080, height: 1080, label: "Carré 1:1 (LinkedIn / Instagram)" },
  "16:9":  { width: 1280, height: 720,  label: "Paysage 16:9 (Twitter / YouTube)" },
  "2:3":   { width: 1000, height: 1500, label: "Portrait 2:3 (Pinterest)" },
};

const PLATFORM_COLORS = {
  "9:16":  "#ff0050",
  "1:1":   "#0a66c2",
  "16:9":  "#1d9bf0",
  "2:3":   "#e60023",
};

export default function SocialExporter({ vp, sourceProject, onClose }) {
  const [status, setStatus] = useState("idle"); // idle | loading | recording | done | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const canvasRef = useRef(null);
  const stopRef = useRef(false);
  const blobUrlRef = useRef(null);

  const FPS = 30;
  const INTRO_DUR = 1.5;
  const OUTRO_DUR = 1.5;

  // Detect format from template or fallback to 16:9
  const templateFormat = vp?.template_format || "16:9";
  const preset = FORMAT_PRESETS[templateFormat] || FORMAT_PRESETS["16:9"];
  const WIDTH = preset.width;
  const HEIGHT = preset.height;
  const accentColor = PLATFORM_COLORS[templateFormat] || "#c8922a";
  const bgColor = vp?.template_colors?.bg || "#050505";

  async function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function startExport() {
    stopRef.current = false;
    setStatus("loading");
    setProgress(0);
    setMessage("Chargement des clips…");
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

    const clips = vp?.clips?.filter(c => c.url) || [];
    if (clips.length === 0) {
      setStatus("error");
      setMessage("Aucun clip avec media dans le montage. Uploadez des images ou vidéos d'abord.");
      return;
    }

    const images = await Promise.all(clips.map(c => loadImage(c.url)));
    setProgress(20);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let stream, recorder, chunks = [];
    try {
      stream = canvas.captureStream(FPS);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9" : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    } catch {
      setStatus("error");
      setMessage("MediaRecorder non supporté. Utilisez Chrome ou Edge.");
      return;
    }

    recorder.start(200);
    setStatus("recording");

    const clipStarts = [];
    let acc = 0;
    for (const c of clips) {
      clipStarts.push(acc);
      acc += c.duration || 3;
    }
    const totalDur = acc;
    const fullDur = INTRO_DUR + totalDur + OUTRO_DUR;
    const totalFrames = Math.ceil(fullDur * FPS);

    setMessage(`Export ${templateFormat} · ${Math.ceil(fullDur)}s · ${clips.length} clips`);

    let lastUpdate = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (stopRef.current) break;

      const t = frame / FPS;
      const clipOffset = t - INTRO_DUR;

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (t < INTRO_DUR) {
        // Intro
        const p = t / INTRO_DUR;
        ctx.globalAlpha = Math.min(1, p / 0.4);
        ctx.fillStyle = accentColor;
        ctx.font = `bold ${Math.round(Math.min(WIDTH, HEIGHT) * 0.06)}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(vp?.title || "", WIDTH / 2, HEIGHT * 0.45);
        if (sourceProject?.artist_name) {
          ctx.font = `300 ${Math.round(Math.min(WIDTH, HEIGHT) * 0.03)}px sans-serif`;
          ctx.fillStyle = "#ffffff";
          ctx.fillText(sourceProject.artist_name.toUpperCase(), WIDTH / 2, HEIGHT * 0.54);
        }
        ctx.globalAlpha = 1;

      } else if (clipOffset >= 0 && clipOffset < totalDur) {
        // Clips
        let clipIdx = 0;
        for (let i = clips.length - 1; i >= 0; i--) {
          if (clipOffset >= clipStarts[i]) { clipIdx = i; break; }
        }
        const clip = clips[clipIdx];
        const img = images[clipIdx];
        const localT = clipOffset - clipStarts[clipIdx];
        const clipDur = clip.duration || 3;
        const transType = clip.transition || vp?.transition || "fade";
        const transT = Math.min(0.4, clipDur * 0.2);
        const tIn = localT < transT ? localT / transT : 1;
        const tOut = localT > clipDur - transT ? (clipDur - localT) / transT : 1;
        const alpha = Math.max(0, Math.min(1, Math.min(tIn, tOut)));

        if (img) {
          const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          const kbP = localT / clipDur;
          const kbScale = 1 + kbP * 0.03;

          ctx.save();
          if (transType === "zoom") {
            const zs = 0.88 + tIn * 0.12;
            ctx.translate(WIDTH / 2, HEIGHT / 2);
            ctx.scale(zs, zs);
            ctx.translate(-WIDTH / 2, -HEIGHT / 2);
          } else if (transType === "slide") {
            ctx.translate((1 - tIn) * WIDTH * 0.12, 0);
          } else if (transType === "blur") {
            ctx.filter = tIn < 1 ? `blur(${(1 - tIn) * 14}px)` : "none";
          } else if (transType === "wipe") {
            ctx.beginPath();
            ctx.rect(0, 0, tIn * WIDTH, HEIGHT);
            ctx.clip();
          } else if (transType === "glitch" && tIn < 1) {
            ctx.translate((Math.random() - 0.5) * (1 - tIn) * 20, 0);
          }

          const finalAlpha = transType === "flash" ? (tIn < 0.5 ? tIn * 2 : Math.min(tOut, 1)) : alpha;
          ctx.globalAlpha = finalAlpha;
          ctx.drawImage(img, (WIDTH - dw * kbScale) / 2, (HEIGHT - dh * kbScale) / 2, dw * kbScale, dh * kbScale);
          ctx.restore();
          ctx.filter = "none";
        }

        // Textes overlay
        const texts = vp?.texts || [];
        for (const txt of texts) {
          const txtStart = txt.startTime ?? 0;
          const txtDur = txt.duration ?? totalDur;
          if (clipOffset < txtStart || clipOffset > txtStart + txtDur) continue;
          ctx.save();
          ctx.globalAlpha = 0.95;
          ctx.font = `${txt.bold ? "700" : "400"} ${txt.size || "2rem"} sans-serif`;
          ctx.fillStyle = txt.color || "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 16;
          const yPos = txt.position === "top" || txt.position === "haut" ? HEIGHT * 0.1
            : txt.position === "bottom" || txt.position === "bas" ? HEIGHT * 0.9
            : HEIGHT * 0.5;
          ctx.fillText(txt.content, WIDTH / 2, yPos);
          ctx.restore();
        }

        // Vignette légère
        const grad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.85);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, "rgba(0,0,0,0.45)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

      } else {
        // Outro
        const p = Math.min((t - INTRO_DUR - totalDur) / OUTRO_DUR, 1);
        ctx.globalAlpha = Math.min(1, p / 0.2);
        ctx.fillStyle = accentColor;
        ctx.font = `bold ${Math.round(Math.min(WIDTH, HEIGHT) * 0.045)}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sourceProject?.outro_text || vp?.title || "JS-INNOV.IA", WIDTH / 2, HEIGHT * 0.45);
        if (sourceProject?.brand_name) {
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.font = `300 ${Math.round(Math.min(WIDTH, HEIGHT) * 0.025)}px sans-serif`;
          ctx.fillText(sourceProject.brand_name.toUpperCase(), WIDTH / 2, HEIGHT * 0.54);
        }
        ctx.globalAlpha = 1;
      }

      if (frame - lastUpdate >= 30) {
        lastUpdate = frame;
        setProgress(20 + Math.round((frame / totalFrames) * 78));
        await new Promise(r => setTimeout(r, 0));
      }
    }

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    const blob = new Blob(chunks, { type: "video/webm" });
    blobUrlRef.current = URL.createObjectURL(blob);
    const fileSizeMb = blob.size / 1024 / 1024;
    
    // Upload to save export
    const { file_url } = await base44.integrations.Core.UploadFile({ file: blob });
    
    // Enregistrer l'export en base
    await base44.functions.invoke('saveVideoExport', {
      video_project_id: vp?.id,
      title: vp?.title || "Montage social",
      format: templateFormat,
      export_type: "social",
      file_url,
      file_size_mb: fileSizeMb,
      duration_seconds: Math.ceil(fullDur),
    });
    
    setProgress(100);
    setStatus("done");
    setMessage(`Prêt — ${fileSizeMb.toFixed(1)} MB · ${Math.ceil(fullDur)}s · ${templateFormat}`);
  }

  const handleDownload = () => {
    const url = blobUrlRef.current;
    if (!url) return;
    const platform = vp?.template_id || "social";
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(vp?.title || "montage").replace(/\s+/g, "_")}_${platform}_${templateFormat.replace(":", "x")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  useEffect(() => {
    return () => {
      stopRef.current = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const totalDurDisplay = Math.ceil(INTRO_DUR + (vp?.clips || []).filter(c => c.url).reduce((s, c) => s + (c.duration || 3), 0) + OUTRO_DUR);
  const mediaClips = (vp?.clips || []).filter(c => c.url);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="card-premium rounded-2xl w-full max-w-md p-6 space-y-5 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: accentColor + "22" }}>
            <Film size={18} style={{ color: accentColor }} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-foreground">Export Social WebM</h2>
            <p className="text-xs text-muted-foreground">{preset.label}</p>
          </div>
        </div>

        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="hidden" />

        <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Format</span><span className="text-foreground">{templateFormat} — {WIDTH}×{HEIGHT}</span></div>
          <div className="flex justify-between"><span>Clips avec media</span><span className="text-foreground">{mediaClips.length} / {(vp?.clips || []).length}</span></div>
          <div className="flex justify-between"><span>Durée estimée</span><span className="text-foreground">{totalDurDisplay}s</span></div>
          <div className="flex justify-between"><span>Transition</span><span className="text-foreground">{vp?.transition || "fade"}</span></div>
        </div>

        {mediaClips.length === 0 && status === "idle" && (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>Aucune image/vidéo uploadée. Ajoutez des médias dans la sidebar avant d'exporter.</span>
          </div>
        )}

        {(status === "loading" || status === "recording") && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{message}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: accentColor }} />
            </div>
            <p className="text-xs text-center text-muted-foreground animate-pulse">🎬 Rendu frame par frame…</p>
          </div>
        )}

        {status === "done" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle size={15} />
              <span className="font-medium">{message}</span>
            </div>
            <button onClick={handleDownload} className="btn-gold w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2">
              <Download size={15} />
              Télécharger le WebM {templateFormat}
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} />
            <span>{message}</span>
          </div>
        )}

        <div className="flex gap-2">
          {status === "idle" && (
            <button onClick={startExport} disabled={mediaClips.length === 0}
              className="btn-gold flex-1 py-3 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-40">
              <Film size={14} />
              Exporter en WebM {templateFormat}
            </button>
          )}
          {(status === "loading" || status === "recording") && (
            <button onClick={() => { stopRef.current = true; setStatus("idle"); setProgress(0); }}
              className="flex-1 py-3 rounded-xl text-sm border border-border text-muted-foreground hover:text-foreground">
              Annuler
            </button>
          )}
          {status === "done" && (
            <button onClick={() => { setStatus("idle"); setProgress(0); }}
              className="flex-1 py-2.5 rounded-xl text-sm border border-border text-muted-foreground hover:text-foreground">
              Nouveau rendu
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
