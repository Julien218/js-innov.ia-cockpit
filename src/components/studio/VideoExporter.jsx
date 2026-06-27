import { useState, useRef, useEffect } from "react";
import { Film, Download, X, AlertCircle, CheckCircle, Image, Loader2, Sparkles } from "lucide-react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";

export default function VideoExporter({ vp, sourceProject, onClose }) {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [coverUrl, setCoverUrl] = useState(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const canvasRef = useRef(null);
  const stopRef = useRef(false);
  const blobUrlRef = useRef(null);

  const FPS = 30;
  const WIDTH = 1920;
  const HEIGHT = 960;
  const INTRO_DUR = 2.5;
  const OUTRO_DUR = 2.5;

  async function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        const img2 = new Image();
        img2.onload = () => resolve(img2);
        img2.onerror = () => resolve(null);
        img2.src = url;
      };
      img.src = url;
    });
  }

  async function startExport() {
    stopRef.current = false;
    setStatus("loading");
    setProgress(0);
    setMessage("Synchronisation…");
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

    // Recharge TOUJOURS depuis la base pour avoir les durées définies par l'agent
    let freshVp = vp;
    if (vp?.id) {
      const [loaded] = await base44.entities.VideoProject.filter({ id: vp.id });
      if (loaded) freshVp = loaded;
    }

    const clips = freshVp?.clips || [];
    if (clips.length === 0) {
      setStatus("error");
      setMessage("Aucun clip dans le montage.");
      return;
    }

    const palette = getPalette(sourceProject?.visual_theme || "Fashion Show");

    setMessage("Chargement des images…");
    // Charger toutes les images en parallèle
    const images = await Promise.all(clips.map(c => loadImage(c.url)));
    setProgress(20);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let stream, recorder, chunks = [];
    try {
      stream = canvas.captureStream(FPS);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9" : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    } catch (e) {
      setStatus("error");
      setMessage("MediaRecorder non supporté. Utilisez Chrome ou Edge.");
      return;
    }

    recorder.start(200);
    setStatus("recording");

    // Précalcul des timestamps de début de chaque clip
    const clipStarts = [];
    let acc = 0;
    for (const c of clips) {
      clipStarts.push(acc);
      acc += c.duration || 4;
    }
    const totalDur = acc;
    const fullDur = INTRO_DUR + totalDur + OUTRO_DUR;
    const totalFrames = Math.ceil(fullDur * FPS);

    setMessage(`Rendu en cours… ${Math.ceil(fullDur)}s · ${clips.length} clips`);

    // Fonction de recherche du clip courant — O(n) mais utilise les précalculs
    function getClipAtOffset(offset) {
      for (let i = clips.length - 1; i >= 0; i--) {
        if (offset >= clipStarts[i]) return i;
      }
      return 0;
    }

    let lastProgressUpdate = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (stopRef.current) break;

      const t = frame / FPS;
      const clipOffset = t - INTRO_DUR;

      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (t < INTRO_DUR) {
        // ── INTRO ──
        const p = t / INTRO_DUR;
        const alpha = p < 0.3 ? p / 0.3 : p > 0.85 ? (1 - p) / 0.15 : 1;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = palette.primary;
        ctx.font = `bold ${Math.round(HEIGHT * 0.07)}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sourceProject?.intro_text || "JS-INNOV.IA vous présente", WIDTH / 2, HEIGHT * 0.42);
        if (sourceProject?.artist_name) {
          ctx.fillStyle = "#ffffff";
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.7;
          ctx.font = `300 ${Math.round(HEIGHT * 0.04)}px sans-serif`;
          ctx.fillText(sourceProject.artist_name.toUpperCase(), WIDTH / 2, HEIGHT * 0.55);
        }
        const lineW = Math.min(p * 300, 200);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = palette.primary;
        ctx.fillRect(WIDTH / 2 - lineW / 2, HEIGHT * 0.65, lineW, 1);
        ctx.globalAlpha = 1;

      } else if (clipOffset >= 0 && clipOffset < totalDur) {
        // ── CLIPS ──
        const clipIdx = getClipAtOffset(clipOffset);
        const clip = clips[clipIdx];
        const img = images[clipIdx];
        const clipStart = clipStarts[clipIdx];
        const clipDur = clip.duration || 4;
        const localT = clipOffset - clipStart;
        const transT = Math.min(0.5, clipDur * 0.18);
        // Transition type par clip (définie par l'agent), fallback sur la globale
        const transType = clip.transition || freshVp?.transition || "fade";

        if (img) {
          const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          const kbProgress = localT / clipDur;
          const kbScale = 1 + kbProgress * 0.04;

          // Progress d'entrée [0..1] et sortie [0..1]
          const tIn  = localT < transT ? localT / transT : 1;
          const tOut = localT > clipDur - transT ? (clipDur - localT) / transT : 1;
          const alpha = Math.max(0, Math.min(1, Math.min(tIn, tOut)));

          ctx.save();

          // Appliquer la transition d'entrée selon le type
          if (transType === "zoom") {
            const zScale = 0.85 + tIn * 0.15;
            ctx.translate(WIDTH / 2, HEIGHT / 2);
            ctx.scale(zScale, zScale);
            ctx.translate(-WIDTH / 2, -HEIGHT / 2);
          } else if (transType === "slide") {
            ctx.translate((1 - tIn) * WIDTH * 0.15, 0);
          } else if (transType === "wipe") {
            ctx.beginPath();
            ctx.rect(0, 0, tIn * WIDTH, HEIGHT);
            ctx.clip();
          } else if (transType === "blur") {
            ctx.filter = tIn < 1 ? `blur(${(1 - tIn) * 18}px)` : "none";
          } else if (transType === "glitch") {
            if (tIn < 1) {
              ctx.translate((Math.random() - 0.5) * (1 - tIn) * 30, 0);
              ctx.filter = `hue-rotate(${(1 - tIn) * 90}deg)`;
            }
          }
          // flash : juste alpha fort
          const finalAlpha = transType === "flash" ? (tIn < 0.5 ? tIn * 2 : Math.min(tOut, 1)) : alpha;
          ctx.globalAlpha = finalAlpha;

          // Rotation définie par l'agent/éditeur
          const rot = (clip.rotation || 0) * Math.PI / 180;
          if (rot !== 0) {
            ctx.translate(WIDTH / 2, HEIGHT / 2);
            ctx.rotate(rot);
            ctx.drawImage(img, -dw * kbScale / 2, -dh * kbScale / 2, dw * kbScale, dh * kbScale);
          } else {
            const kbX = (WIDTH - dw * kbScale) / 2 - kbProgress * WIDTH * 0.008;
            const kbY = (HEIGHT - dh * kbScale) / 2;
            ctx.drawImage(img, kbX, kbY, dw * kbScale, dh * kbScale);
          }

          ctx.restore();
          // Reset filter after restore (some browsers persist it)
          ctx.filter = "none";
        }

        // Textes overlay
        const texts = freshVp?.texts || [];
        for (const txt of texts) {
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.font = `${txt.bold ? "700" : "400"} ${txt.size || "2rem"} sans-serif`;
          ctx.fillStyle = txt.color || "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 20;
          const yPos = txt.position === "haut" ? HEIGHT * 0.1 : txt.position === "bas" ? HEIGHT * 0.9 : HEIGHT * 0.5;
          ctx.fillText(txt.content, WIDTH / 2, yPos);
          ctx.restore();
        }

        // Vignette
        const grad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.8);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, "rgba(0,0,0,0.5)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

      } else {
        // ── OUTRO ──
        const p = Math.min((t - INTRO_DUR - totalDur) / OUTRO_DUR, 1);
        const alpha = p < 0.15 ? p / 0.15 : 1;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = palette.primary;
        ctx.font = `bold ${Math.round(HEIGHT * 0.065)}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sourceProject?.outro_text || "Une création JS-INNOV.IA", WIDTH / 2, HEIGHT * 0.42);
        if (sourceProject?.brand_name) {
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.font = `300 ${Math.round(HEIGHT * 0.03)}px sans-serif`;
          ctx.fillText(sourceProject.brand_name.toUpperCase(), WIDTH / 2, HEIGHT * 0.55);
        }
        ctx.globalAlpha = 1;
      }

      // Mise à jour progress max 1x / 30 frames (1s) pour éviter les re-renders
      if (frame - lastProgressUpdate >= 30) {
        lastProgressUpdate = frame;
        setProgress(20 + Math.round((frame / totalFrames) * 78));
        // Yield au navigateur 1x par seconde
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    recorder.stop();
    await new Promise((r) => { recorder.onstop = r; });

    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    const fileSizeMb = blob.size / 1024 / 1024;
    
    // Upload to save export
    const { file_url } = await base44.integrations.Core.UploadFile({ file: blob });
    
    // Enregistrer l'export en base
    await base44.functions.invoke('saveVideoExport', {
      video_project_id: vp?.id,
      title: freshTitle(),
      format: "WebM",
      export_type: "simple",
      file_url,
      file_size_mb: fileSizeMb,
      duration_seconds: Math.ceil(fullDur),
    });
    
    setProgress(100);
    setStatus("done");
    setMessage(`Vidéo prête — ${fileSizeMb.toFixed(1)} MB · ${Math.ceil(fullDur)}s`);

    // Génération automatique de la couverture IA
    generateCover(freshVp);
  }

  async function generateCover(freshVp) {
    setGeneratingCover(true);
    const title = freshVp?.title || vp?.title || "Production vidéo";
    const theme = sourceProject?.visual_theme || "Fashion Show";
    const artist = sourceProject?.artist_name || "";
    const event = sourceProject?.event_name || "";

    const styleMap = {
      "Fashion Show": "fond noir élégant, reflets dorés, typographie mode haute couture, lumière cinématographique",
      "Club": "fond sombre avec lumières neon cyan et violet, ambiance underground, typographie électro bold",
      "Luxe": "fond très sombre, dorures et argentures, typographie serif premium, style Rolex ou Dior",
      "Art Expo": "fond blanc ou gris clair, typographie minimaliste, composition avant-gardiste, style galerie contemporaine",
      "Corporate": "fond bleu professionnel, typographie clean sans-serif, composition structurée, style tech premium",
      "Personnalisé": "fond sombre dramatique, typographie bold, lumière Rembrandt, style éditorial premium",
    };

    const prompt = `Couverture de vidéo événementielle percutante. Titre principal : "${title}". ${artist ? `Artiste / sujet : ${artist}.` : ""} ${event ? `Événement : ${event}.` : ""}
Style visuel : ${styleMap[theme] || styleMap["Personnalisé"]}.
Composition horizontale 16:9, très haut contraste, typographie lisible et dominante, pas de watermark, rendu photoréaliste cinématographique premium. Le titre doit être clairement visible et accrocheur.`;

    const result = await base44.integrations.Core.GenerateImage({ prompt });
    setCoverUrl(result.url);
    setGeneratingCover(false);
  }

  const handleDownload = () => {
    const url = blobUrlRef.current;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(freshTitle()).replace(/\s+/g, "_")}_JSINNOVIA.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  function freshTitle() {
    return vp?.title || "montage";
  }

  useEffect(() => {
    return () => {
      stopRef.current = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const totalDurDisplay = Math.ceil(INTRO_DUR + (vp?.clips || []).reduce((s, c) => s + (c.duration || 4), 0) + OUTRO_DUR);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="card-premium rounded-2xl w-full max-w-lg p-6 space-y-5 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Film size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-foreground">Export Vidéo WebM</h2>
            <p className="text-xs text-muted-foreground">Rendu canvas navigateur — durées agent respectées</p>
          </div>
        </div>

        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="hidden" />

        <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Résolution</span><span className="text-foreground">1920 × 960</span></div>
          <div className="flex justify-between"><span>Format</span><span className="text-foreground">WebM VP9 · 8 Mbps · 30 fps</span></div>
          <div className="flex justify-between"><span>Clips</span><span className="text-foreground">{vp?.clips?.length || 0} images</span></div>
          <div className="flex justify-between"><span>Durée totale</span><span className="text-foreground">{totalDurDisplay}s</span></div>
          <div className="flex justify-between"><span>Durées clips</span><span className="text-foreground text-right max-w-[60%] truncate">{(vp?.clips || []).map(c => `${c.duration || 4}s`).join(" · ")}</span></div>
          <div className="flex justify-between"><span>Transitions</span><span className="text-foreground text-right max-w-[60%] truncate">{(vp?.clips || []).map(c => c.transition || "fade").join(" · ")}</span></div>
        </div>

        {status === "idle" && (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>Les durées sont rechargées depuis la base — les modifications de l'agent seront bien appliquées. Chrome/Edge recommandé.</span>
          </div>
        )}

        {(status === "loading" || status === "recording") && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{message}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
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
              Télécharger la vidéo WebM
            </button>

            {/* Couverture IA */}
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Image size={12} className="text-primary" />
                Image de couverture IA
              </div>
              {generatingCover ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
                  <Loader2 size={12} className="animate-spin text-primary" />
                  Génération de la couverture en cours…
                </div>
              ) : coverUrl ? (
                <div className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-border">
                    <img src={coverUrl} alt="Couverture" className="w-full object-cover" />
                  </div>
                  <div className="flex gap-2">
                    <a href={coverUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                      Voir en grand
                    </a>
                    <button onClick={() => generateCover(vp)} disabled={generatingCover}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Sparkles size={11} /> Régénérer
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
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
            <button onClick={startExport} className="btn-gold flex-1 py-3 rounded-xl text-sm flex items-center justify-center gap-2">
              <Film size={14} />
              Lancer l'export vidéo
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

function getPalette(theme) {
  const palettes = {
    "Fashion Show": { primary: "#c8922a", bg: "#050505" },
    "Club":         { primary: "#00f5ff", bg: "#020010" },
    "Luxe":         { primary: "#d4c5a9", bg: "#08070a" },
    "Art Expo":     { primary: "#ff3366", bg: "#0a0a0a" },
    "Corporate":    { primary: "#4a90d9", bg: "#030810" },
    "Personnalisé": { primary: "#c8922a", bg: "#050505" },
  };
  return palettes[theme] || palettes["Fashion Show"];
}
