import { useState, useRef, useEffect } from "react";
import { Film, Download, X, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";

const FPS = 30;
const FONTS = { normal: "600 36px sans-serif", small: "400 24px sans-serif", large: "700 56px sans-serif" };

function parsePx(v, def = 36) {
  if (!v) return def;
  return parseInt(String(v).replace("px", ""), 10) || def;
}

function getPositionCoords(position, W, H, textW = 0) {
  const cx = W / 2;
  switch (position) {
    case "top": return { x: cx, y: H * 0.12, align: "center" };
    case "center": return { x: cx, y: H * 0.5, align: "center" };
    case "bottom": return { x: cx, y: H * 0.88, align: "center" };
    case "top-left": return { x: 40, y: 40, align: "left" };
    case "top-right": return { x: W - 40, y: 40, align: "right" };
    case "top-center": return { x: cx, y: 40, align: "center" };
    default: return { x: cx, y: H * 0.5, align: "center" };
  }
}

async function loadImg(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function drawBackground(ctx, W, H, color = "#000000") {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

function drawImage(ctx, img, W, H, style = {}) {
  if (!img) return;
  const size = style.size || 500;
  const { x, y } = getPositionCoords(style.position || "center", W, H);
  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
  ctx.restore();
}

function drawVideoFrame(ctx, video, W, H) {
  if (!video) return;
  const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
  const dw = video.videoWidth * scale;
  const dh = video.videoHeight * scale;
  ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawTextClip(ctx, clip, W, H, alpha = 1) {
  const style = clip.style || {};
  const fontSize = parsePx(style.fontSize || style.size, 36);
  const color = style.color || "#ffffff";
  const bold = style.bold ? "700" : "400";
  const content = clip.content || "";
  const { x, y, align } = getPositionCoords(style.position || "center", W, H);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${bold} ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 18;
  ctx.fillText(content, x, y);
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, "transparent");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export default function MultiTrackExporter({ vp, tracks, sourceProject, onClose }) {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [blobUrl, setBlobUrl] = useState(null);
  const [blobSize, setBlobSize] = useState(0);
  const [totalSec, setTotalSec] = useState(0);
  const canvasRef = useRef(null);
  const stopRef = useRef(false);

  const W = vp?.template_format === "9:16" ? 1080 : 1920;
  const H = vp?.template_format === "9:16" ? 1920 : 960;
  const bgColor = vp?.template_colors?.bg || "#000000";

  const allClips = (tracks || []).flatMap(t => (t.clips || []).map(c => ({ ...c, trackType: t.type })));
  const videoDuration = vp?.template_duration || Math.max(
    ...allClips.map(c => (c.startTime || 0) + (c.duration || 4)), 10
  );

  useEffect(() => setTotalSec(videoDuration), [videoDuration]);
  useEffect(() => () => { stopRef.current = true; if (blobUrl) URL.revokeObjectURL(blobUrl); }, []);

  const startExport = async () => {
    stopRef.current = false;
    setBlobUrl(null);
    setStatus("loading");
    setProgress(0);
    setMessage("Chargement des assets…");

    // Load all images
    const imageMap = {};
    for (const clip of allClips) {
      if (clip.url && !imageMap[clip.url]) {
        imageMap[clip.url] = await loadImg(clip.url);
      }
    }
    setProgress(10);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(FPS);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.start(250);
    setStatus("recording");
    setMessage(`Rendu ${Math.ceil(videoDuration)}s · ${W}×${H}`);

    const totalFrames = Math.ceil(videoDuration * FPS);
    let lastYield = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (stopRef.current) break;
      const t = frame / FPS;

      // Background
      drawBackground(ctx, W, H, bgColor);

      // Sort by track order (video tracks first, then image, then text on top)
      const layerOrder = ["video", "image", "effects", "text"];

      for (const layerType of layerOrder) {
        const layerClips = allClips.filter(c =>
          c.trackType === layerType &&
          t >= (c.startTime ?? 0) &&
          t < (c.startTime ?? 0) + (c.duration ?? 4)
        );

        for (const clip of layerClips) {
          const localT = t - (clip.startTime ?? 0);
          const clipDur = clip.duration ?? 4;
          const transT = Math.min(0.4, clipDur * 0.15);

          // Alpha fade for clip transitions
          let alpha = 1;
          if (localT < transT) alpha = localT / transT;
          else if (localT > clipDur - transT) alpha = (clipDur - localT) / transT;
          alpha = Math.max(0, Math.min(1, alpha));

          if (layerType === "video" || layerType === "image") {
            const img = clip.url ? imageMap[clip.url] : null;
            if (img) {
              ctx.save();
              ctx.globalAlpha = alpha;
              if (clip.style?.position && clip.style.position !== "full") {
                drawImage(ctx, img, W, H, clip.style);
              } else {
                // Full cover (video/image)
                const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
                const dw = img.naturalWidth * scale;
                const dh = img.naturalHeight * scale;
                // Subtle Ken Burns
                const kbProgress = localT / clipDur;
                const kbScale = 1 + kbProgress * 0.03;
                const kbX = (W - dw * kbScale) / 2;
                const kbY = (H - dh * kbScale) / 2;
                ctx.drawImage(img, kbX, kbY, dw * kbScale, dh * kbScale);
              }
              ctx.restore();
            } else if (!clip.url) {
              // Placeholder — colored rectangle
              ctx.save();
              ctx.globalAlpha = alpha * 0.3;
              ctx.fillStyle = vp?.template_colors?.primary || "#c8922a";
              ctx.fillRect(0, 0, W, H);
              ctx.globalAlpha = alpha * 0.7;
              ctx.fillStyle = "#ffffff";
              ctx.font = "300 32px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(clip.label || "Placeholder", W / 2, H / 2);
              ctx.restore();
            }
          } else if (layerType === "text") {
            drawTextClip(ctx, clip, W, H, alpha);
          }
        }
      }

      // Vignette
      drawVignette(ctx, W, H);

      if (frame - lastYield >= FPS) {
        lastYield = frame;
        setProgress(10 + Math.round((frame / totalFrames) * 88));
        await new Promise(r => setTimeout(r, 0));
      }
    }

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const fileSizeMb = blob.size / 1024 / 1024;
    
    // Upload to save export
    const { file_url } = await base44.integrations.Core.UploadFile({ file: blob });
    
    // Enregistrer l'export en base
    await base44.functions.invoke('saveVideoExport', {
      video_project_id: vp?.id,
      title: vp?.title || "Montage multipiste",
      format: vp?.template_format || "16:9",
      export_type: "multitrack",
      file_url,
      file_size_mb: fileSizeMb,
      duration_seconds: Math.ceil(totalSec),
    });
    
    setBlobUrl(url);
    setBlobSize(blob.size);
    setProgress(100);
    setStatus("done");
    setMessage(`Export terminé — ${fileSizeMb.toFixed(1)} MB`);
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${(vp?.title || "export").replace(/\s+/g, "_")}_JSINNOVIA.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4">
      <div className="card-premium rounded-2xl w-full max-w-md p-6 space-y-5 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Film size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-foreground">Export Vidéo Multipiste</h2>
            <p className="text-xs text-muted-foreground">Rendu canvas avec superpositions et textes</p>
          </div>
        </div>

        <canvas ref={canvasRef} width={W} height={H} className="hidden" />

        {/* Specs */}
        <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Format</span><span className="text-foreground">{vp?.template_format || "16:9"} · {W}×{H}</span></div>
          <div className="flex justify-between"><span>Durée</span><span className="text-foreground">{Math.ceil(totalSec)}s</span></div>
          <div className="flex justify-between"><span>Pistes</span><span className="text-foreground">{(tracks || []).length} pistes · {allClips.length} clips</span></div>
          <div className="flex justify-between"><span>Codec</span><span className="text-foreground">WebM VP9 · 10 Mbps · 30fps</span></div>
        </div>

        {status === "idle" && (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            Utilisez Chrome ou Edge pour l'export. Les pistes sont superposées dans l'ordre (vidéo → image → texte).
          </div>
        )}

        {(status === "loading" || status === "recording") && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />{message}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
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
              Télécharger ({(blobSize / 1024 / 1024).toFixed(1)} MB)
            </button>
          </div>
        )}

        <div className="flex gap-2">
          {status === "idle" && (
            <button onClick={startExport} className="btn-gold flex-1 py-3 rounded-xl text-sm flex items-center justify-center gap-2">
              <Film size={14} />
              Lancer l'export
            </button>
          )}
          {(status === "loading" || status === "recording") && (
            <button onClick={() => { stopRef.current = true; setStatus("idle"); setProgress(0); }}
              className="flex-1 py-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">
              Annuler
            </button>
          )}
          {status === "done" && (
            <button onClick={() => { setStatus("idle"); setProgress(0); setBlobUrl(null); }}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">
              Nouveau rendu
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
