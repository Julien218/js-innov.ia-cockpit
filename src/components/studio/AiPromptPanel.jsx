import { useState } from "react";
import { Sparkles, Copy, Check } from "lucide-react";

export default function AiPromptPanel({ prompt, loading, onGenerate, onUpdate }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-5 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold gold-text">Prompt IA — RunwayML / Sora / Kling</h3>
        <div className="flex items-center gap-2">
          {prompt && !editing && (
            <button onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copié !" : "Copier"}
            </button>
          )}
          <button onClick={onGenerate} disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg btn-gold disabled:opacity-50">
            <Sparkles size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Génération…" : prompt ? "Régénérer" : "Générer"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-sm">Génération du prompt IA en cours…</p>
          <p className="text-xs opacity-60">Utilise Claude Sonnet — qualité premium</p>
        </div>
      ) : prompt ? (
        <div className="space-y-2">
          {editing ? (
            <textarea
              value={prompt}
              onChange={e => onUpdate(e.target.value)}
              rows={18}
              className="w-full bg-muted border border-border rounded-xl p-4 text-sm text-foreground/80 leading-relaxed font-sans resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed font-sans bg-muted rounded-xl p-4 max-h-80 overflow-y-auto">
              {prompt}
            </pre>
          )}
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)}
              className="text-xs text-primary hover:underline">
              {editing ? "Fermer l'édition" : "Modifier le prompt"}
            </button>
          </div>
          <div className="card-premium rounded-xl p-4 border-l-2 border-l-primary/50 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/70">💡 Utilisation du prompt :</p>
            <p>1. Copiez le prompt ci-dessus</p>
            <p>2. Collez-le dans <strong>RunwayML</strong>, <strong>Sora</strong>, <strong>Kling</strong> ou votre agent monteur OpenAI</p>
            <p>3. Uploadez vos images sources dans l'outil choisi</p>
            <p>4. Lancez la génération — format cible : <strong>3840×1920 ratio 2:1</strong></p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <div className="text-5xl">🤖</div>
          <p className="text-sm">Aucun prompt généré.</p>
          <p className="text-xs opacity-60 text-center max-w-xs">Ajoutez des clips dans la timeline, puis cliquez sur "Générer" pour créer un prompt détaillé prêt pour RunwayML / Sora / Kling.</p>
          <button onClick={onGenerate} className="btn-gold flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm mt-2">
            <Sparkles size={14} />Générer le prompt IA
          </button>
        </div>
      )}
    </div>
  );
}
