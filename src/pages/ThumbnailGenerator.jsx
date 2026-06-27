import { useState } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Sparkles, Download, RefreshCw, Image, Loader2, Zap, Eye } from "lucide-react";

const STYLES = [
  { id: "youtube_shock", label: "🔴 Choc YouTube", desc: "Fond rouge vif, texte blanc bold, émotion forte" },
  { id: "clickbait_face", label: "😮 Visage expressif", desc: "Personnage expressif + texte accrocheur jaune" },
  { id: "vs_split", label: "⚡ VS / Comparaison", desc: "Écran partagé avec contraste fort" },
  { id: "luxury_dark", label: "💎 Premium sombre", desc: "Fond noir, dorure, texte élégant" },
  { id: "news_breaking", label: "📺 Breaking News", desc: "Style infos urgentes avec bandeau" },
  { id: "tutorial", label: "🎓 Tutoriel / Tuto", desc: "Flèches, numéros, fond propre" },
];

const FORMATS = [
  { id: "youtube", label: "YouTube", ratio: "16:9", w: 1280, h: 720 },
  { id: "intro", label: "Image d'intro", ratio: "16:9", w: 1920, h: 1080 },
  { id: "shorts", label: "Shorts / Reels", ratio: "9:16", w: 1080, h: 1920 },
];

export default function ThumbnailGenerator() {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [style, setStyle] = useState("youtube_shock");
  const [format, setFormat] = useState("youtube");
  const [context, setContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const selectedFormat = FORMATS.find(f => f.id === format);

  const handleGenerate = async () => {
    if (!title.trim()) { setError("Titre obligatoire."); return; }
    setError(null);
    setGenerating(true);

    const styleObj = STYLES.find(s => s.id === style);

    const prompt = buildPrompt({ title, subtitle, style: styleObj, format: selectedFormat, context });

    // Génère 2 variantes en parallèle
    const [r1, r2] = await Promise.all([
      base44.integrations.Core.GenerateImage({ prompt }),
      base44.integrations.Core.GenerateImage({ prompt: prompt + " variante colorimétrique différente, même concept." }),
    ]);

    setResults([r1.url, r2.url]);
    setGenerating(false);
  };

  const handleDownload = (url, idx) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `thumbnail_${format}_v${idx + 1}.png`;
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="min-h-screen bg-background px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Image size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Miniature Generator</h1>
            <p className="text-sm text-muted-foreground">Générez des miniatures YouTube optimisées CTR par IA</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT — Config */}
        <div className="space-y-5">
          {/* Format */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Format</label>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map(f => (
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${format === f.id ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                  <div className="font-semibold">{f.label}</div>
                  <div className="opacity-60 text-[10px]">{f.ratio}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Titre principal */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              Titre accrocheur <span className="text-destructive">*</span>
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ex: LE SECRET que YouTube cache…"
              className="w-full bg-input border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Sous-titre */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Sous-titre / badge</label>
            <input
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="ex: INCROYABLE · RÉVÉLÉ · +1M vues"
              className="w-full bg-input border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Style visuel */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Style visuel</label>
            <div className="space-y-2">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${style === s.id ? "border-primary bg-accent" : "border-border hover:border-primary/30"}`}>
                  <div className="text-sm font-medium text-foreground">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Contexte optionnel */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Contexte / sujet (optionnel)</label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="ex: vidéo sur le montage vidéo pour débutants, avec un jeune créateur enthousiaste"
              rows={3}
              className="w-full bg-input border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {error && (
            <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">{error}</div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-gold w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? "Génération en cours (×2 variantes)…" : "Générer 2 miniatures IA"}
          </button>

          {/* Tips CTR */}
          <div className="card-premium rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={13} className="text-primary" />
              <span className="text-xs font-semibold text-foreground">Tips CTR YouTube</span>
            </div>
            {[
              "Contraste fort : fond sombre + texte jaune/blanc",
              "Visage expressif (surprise, choc) = +40% CTR",
              "Maximum 3-5 mots sur la miniature",
              "Flèches et cercles rouges attirent l'œil",
              "Texte lisible même en 120px (mobile)",
            ].map((tip, i) => (
              <p key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary shrink-0">✓</span>{tip}
              </p>
            ))}
          </div>
        </div>

        {/* RIGHT — Résultats */}
        <div className="space-y-4">
          {generating ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Loader2 size={32} className="animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Génération de 2 variantes en parallèle…</p>
            </div>
          ) : results.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{results.length} variantes générées · {selectedFormat.label} {selectedFormat.w}×{selectedFormat.h}</p>
              {results.map((url, i) => (
                <div key={i} className="card-premium rounded-2xl overflow-hidden group relative">
                  <img src={url} alt={`Miniature ${i + 1}`} className="w-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-lg hover:bg-white/20 transition">
                      <Eye size={13} /> Voir
                    </a>
                    <button onClick={() => handleDownload(url, i)}
                      className="flex items-center gap-1.5 btn-gold text-xs px-3 py-2 rounded-lg">
                      <Download size={13} /> Télécharger
                    </button>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Variante {i + 1}</span>
                    <button onClick={() => handleDownload(url, i)}
                      className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Download size={11} /> Télécharger
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground text-xs transition-colors">
                <RefreshCw size={13} /> Régénérer de nouvelles variantes
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 gap-3 card-premium rounded-2xl">
              <Image size={40} className="text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Vos miniatures apparaîtront ici</p>
              <p className="text-xs text-muted-foreground/60">2 variantes générées en parallèle</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildPrompt({ title, subtitle, style, format, context }) {
  const dimensionHint = format.id === "shorts" ? "vertical 9:16" : "horizontal 16:9";
  const contextLine = context ? `Sujet : ${context}.` : "";
  const subLine = subtitle ? `Badge/sous-titre visible : "${subtitle}"` : "";

  const stylePrompts = {
    youtube_shock: `Miniature YouTube ultra-percutante, fond rouge vif ou noir, texte "${title}" en lettres blanches très grasses et énormes, contours jaunes, visage humain expressif en choc ou surprise, lumière dramatique, style MrBeast.`,
    clickbait_face: `Miniature YouTube clickbait : visage humain montrant une émotion extrême (surprise, peur, incrédulité), bouche ouverte, yeux écarquillés, texte "${title}" en jaune bold sur fond sombre, flèches rouges pointant vers le visage.`,
    vs_split: `Miniature YouTube split-screen, deux côtés en fort contraste (avant/après ou VS), texte "${title}" centré en lettres énormes blanches avec ombre, icône VS rouge au centre, photographie réaliste haute qualité.`,
    luxury_dark: `Miniature premium, fond très sombre presque noir, reflets dorés et argentés, texte "${title}" en dorure élégante, style luxe haut de gamme, lumière Rembrandt, product shot cinématographique.`,
    news_breaking: `Miniature style Breaking News, bandeau rouge avec texte "BREAKING" ou "URGENT", fond sérieux, texte "${title}" en typo news bold, sentiment d'urgence et d'information importante.`,
    tutorial: `Miniature tutoriel claire et professionnelle, fond bleu ou vert propre, numéros grands et colorés, flèches indiquant les étapes, texte "${title}" lisible et net, style moderne et pédagogique.`,
  };

  return `${stylePrompts[style.id]}
${subLine}
${contextLine}
Format ${dimensionHint}, résolution ${format.w}x${format.h}.
Texte lisible même en petite taille, fort contraste, composition centrée, qualité photographique et graphique premium.
Ne pas inclure de watermark ni de logo. Rendu photoréaliste ou illustration selon le style.`;
}
