import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

export default function OutputBlock({ title, content, icon, onRegenerate, loading }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card-premium rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{icon}</span>
          <h3 className="font-display text-sm font-semibold text-white">{title}</h3>
          {content && <span className="hidden md:inline text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Généré</span>}
        </div>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
              disabled={loading}
              title="Régénérer"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-secondary hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          )}
          {content && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-secondary hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copié !" : "Copier"}
            </button>
          )}
          {collapsed
            ? <ChevronDown size={16} className="text-muted-foreground" />
            : <ChevronUp size={16} className="text-muted-foreground" />
          }
        </div>
      </div>
      {!collapsed && (
        <div className="px-5 pb-5">
          {loading ? (
            <div className="flex items-center gap-3 py-6 text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-sm">Génération en cours…</span>
            </div>
          ) : content ? (
            <pre className="whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed font-sans bg-muted rounded-lg p-4 max-h-[32rem] overflow-y-auto">
              {content}
            </pre>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-sm">
              <p className="mb-2">Pas encore généré.</p>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="text-xs text-primary hover:underline"
                >
                  Générer maintenant →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
