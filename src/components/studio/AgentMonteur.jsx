import { useState, useEffect, useRef } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Bot, Send, Sparkles, ExternalLink, Film, Loader2, Download, Info, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import VideoExporter from "./VideoExporter";

const AGENTS = [
  {
    id: "video_editor",
    label: "🎬 Monteur Créatif",
    desc: "Structure narrative, rythme cinématographique, liberté créative",
    color: "text-primary border-primary/40 bg-primary/5",
  },
  {
    id: "tempo_sync_editor",
    label: "🎵 Tempo Sync",
    desc: "Synchronisation stricte au BPM, durées calées sur les beats",
    color: "text-blue-400 border-blue-400/40 bg-blue-400/5",
  },
];

export default function AgentMonteur({ vp, sourceProject, onRenderReady, onAgentUpdated }) {
  const [selectedAgent, setSelectedAgent] = useState("video_editor");
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [showExporter, setShowExporter] = useState(false);
  const [freshVp, setFreshVp] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    const unsub = base44.agents.subscribeToConversation(conversationId, (data) => {
      const msgs = data.messages || [];
      setMessages(msgs);

      // Dès qu'un tool_call "VideoProject update" est complété → recharger le vp
      for (const msg of msgs) {
        if (msg.tool_calls?.some(tc =>
          tc.status === "completed" &&
          (tc.name?.includes("VideoProject") || tc.name?.includes("update"))
        )) {
          if (onAgentUpdated) onAgentUpdated();
          // Recharger le vp frais pour l'export
          if (vp?.id) {
            base44.entities.VideoProject.filter({ id: vp.id }).then(([loaded]) => {
              if (loaded) setFreshVp(loaded);
            });
          }
          break;
        }
      }
    });
    return () => unsub();
  }, [conversationId, onAgentUpdated]);

  const buildInitialMessage = () => {
    const clips = vp?.clips || [];
    const bpm = sourceProject?.bpm || 120;
    const beatDur = (60 / bpm).toFixed(3);

    const clipsJson = JSON.stringify(
      clips.map((c, i) => ({
        index: i + 1,
        id: c.id,
        name: c.name || `Clip ${i + 1}`,
        url: c.url,
        type: c.type || "image",
        duration_actuelle: c.duration || 4,
        transition_actuelle: c.transition || vp?.transition || "fade",
        rotation: c.rotation || 0,
        trimStart: c.trimStart || 0,
        trimEnd: c.trimEnd || 0,
      })),
      null, 2
    );

    const base = `## VIDEOPROJET
ID: ${vp?.id}
Titre: ${vp?.title || "Sans titre"}
Transition globale: ${vp?.transition || "fade"}
Audio: ${vp?.audio_name || "aucun"}

## CLIPS (JSON complet — utilise ces données directement, ne lis pas la base)
${clipsJson}

## PROJET SOURCE
Thème: ${sourceProject?.visual_theme || "–"}
BPM: ${bpm} → beat_duration = ${beatDur}s
Artiste: ${sourceProject?.artist_name || "–"}
Durée cible: ${sourceProject?.duration_seconds || "–"}s
Rythme: ${sourceProject?.rhythm_style || "–"}
Intensité: ${sourceProject?.edit_intensity || "–"}
Style musical: ${sourceProject?.music_style || "–"}
Notes: ${sourceProject?.creative_notes || "–"}`;

    if (selectedAgent === "tempo_sync_editor") {
      return `Lance la synchronisation tempo. ${base}

---
INSTRUCTIONS STRICTES :
1. Utilise BPM=${bpm} → beat_duration=${beatDur}s
2. Pour chaque clip : calcule beats_count = round(duration / ${beatDur}), new_duration = beats_count × ${beatDur} (min 1 beat)
3. Si la durée est déjà dans ±5% d'un multiple de beat → conserve-la telle quelle
4. Attribue les transitions selon le BPM (${bpm} BPM)
5. Mets à jour VideoProject ID ${vp?.id} — conserve absolument : id, url, name, type, rotation, trimStart, trimEnd
6. Présente le tableau de synchronisation avec les colonnes : # | Clip | Durée originale | Beats | Durée finale | Transition | Δ`;
    }

    return `Lance le montage automatique. ${base}

## PROMPT IA DÉJÀ GÉNÉRÉ
${vp?.ai_prompt ? vp.ai_prompt.slice(0, 2000) : "Aucun — base-toi sur les données ci-dessus."}

---
INSTRUCTIONS : Génère le plan de montage calé sur le BPM (${bpm} BPM = ${beatDur}s/beat), puis mets à jour le VideoProject ID ${vp?.id} avec le tableau clips modifié (conserve id, url, name, type — modifie uniquement duration et transition). Présente le plan sous forme de tableau.`;
  };

  const startSession = async () => {
    if (!vp?.id) {
      alert("⚠️ Sauvegardez d'abord le projet (bouton \"Sauvegarder\" en haut) avant de lancer l'agent.");
      return;
    }
    if ((vp?.clips || []).length === 0) {
      alert("⚠️ Ajoutez des clips dans l'onglet \"Médias\" de la sidebar avant de lancer l'agent.");
      return;
    }

    setSending(true);
    const conv = await base44.agents.createConversation({
      agent_name: selectedAgent,
      metadata: { name: vp?.title || "Montage sans titre" },
    });
    setConversation(conv);
    setConversationId(conv.id);

    await base44.agents.addMessage(conv, {
      role: "user",
      content: buildInitialMessage(),
    });
    setSending(false);
  };

  const resetSession = () => {
    setConversationId(null);
    setConversation(null);
    setMessages([]);
    setRenderResult(null);
  };

  const sendMessage = async () => {
    if (!input.trim() || !conversation || sending) return;
    const msg = input.trim();
    setInput("");
    setSending(true);
    await base44.agents.addMessage(conversation, { role: "user", content: msg });
    setSending(false);
  };

  const handleRender = async () => {
    if (!vp?.id) {
      alert("Sauvegardez d'abord le projet avant de lancer le rendu.");
      return;
    }
    setRendering(true);
    const res = await base44.functions.invoke("renderVideoCanvas", { videoProjectId: vp.id });
    setRenderResult(res.data);
    if (onRenderReady) onRenderReady(res.data);
    setRendering(false);
  };

  const canStart = vp?.id && (vp?.clips || []).length > 0;

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot size={14} className="text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground font-display">
                {AGENTS.find(a => a.id === selectedAgent)?.label || "Agent Monteur IA"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {vp?.clips?.length || 0} clips · {sourceProject?.bpm || "–"} BPM · {sourceProject?.visual_theme || "–"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {conversationId && (
              <button
                onClick={resetSession}
                title="Nouvelle session"
                className="flex items-center gap-1 px-2 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={11} />
              </button>
            )}
            <button
              onClick={() => setShowExporter(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg btn-gold text-xs"
            >
              <Download size={12} />
              Export vidéo
            </button>
            <button
              onClick={handleRender}
              disabled={rendering || !vp?.id}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {rendering ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
              {rendering ? "…" : "HTML5"}
            </button>
          </div>
        </div>

        {/* Render result */}
        {renderResult && (
          <div className="mx-4 mt-3 card-premium rounded-xl p-4 border-l-2 border-l-green-500/50 shrink-0">
            <div className="flex items-center gap-2 text-green-400 mb-2">
              <Film size={13} />
              <span className="text-xs font-semibold">Rendu HTML5 — {renderResult.clipCount} clips · {renderResult.totalDuration}s</span>
            </div>
            {renderResult.driveUrl ? (
              <a href={renderResult.driveUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <ExternalLink size={11} /> Ouvrir sur Google Drive
              </a>
            ) : null}
            <button
              onClick={() => {
                const blob = new Blob([renderResult.html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rendu_montage.html";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground underline block"
            >
              Télécharger le fichier HTML →
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* État initial — pas encore de session */}
          {messages.length === 0 && !sending && !conversationId && (
            <div className="text-center py-4 space-y-4">
              <div className="text-4xl">🎬</div>

              {/* Agent selector */}
              <div className="max-w-xs mx-auto space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Choisir l'agent</p>
                {AGENTS.map(ag => (
                  <button
                    key={ag.id}
                    onClick={() => setSelectedAgent(ag.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all text-xs ${
                      selectedAgent === ag.id
                        ? ag.color + " font-semibold"
                        : "border-border text-muted-foreground hover:border-border/80"
                    }`}
                  >
                    <div className="font-medium">{ag.label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{ag.desc}</div>
                  </button>
                ))}
              </div>

              {/* Étapes selon agent */}
              <div className="text-left space-y-2 max-w-xs mx-auto">
                {selectedAgent === "tempo_sync_editor" ? (
                  <>
                    <p className="text-xs font-semibold text-foreground">Mode Tempo Sync</p>
                    {[
                      { n: "1", label: "Calcule beat_duration = 60 / BPM" },
                      { n: "2", label: "Arrondit chaque clip au multiple de beat le plus proche" },
                      { n: "3", label: "Conserve les durées déjà calées (±5%)" },
                      { n: "4", label: "Attribue les transitions selon l'énergie du BPM" },
                      { n: "5", label: "Met à jour le VideoProject sans rien modifier d'autre" },
                    ].map(s => (
                      <div key={s.n} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-blue-400/20 text-blue-400 text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">{s.n}</span>
                        <span className="text-xs text-muted-foreground">{s.label}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-foreground">Mode Monteur Créatif</p>
                    {[
                      { n: "1", label: "L'agent lit tous vos clips et le projet source" },
                      { n: "2", label: "Il calcule les durées calées sur le BPM" },
                      { n: "3", label: "Il génère un plan de montage en 5 actes" },
                      { n: "4", label: "Il met à jour automatiquement votre VideoProject" },
                      { n: "5", label: "Vous pouvez affiner en lui écrivant directement" },
                    ].map(s => (
                      <div key={s.n} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">{s.n}</span>
                        <span className="text-xs text-muted-foreground">{s.label}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Alertes pré-conditions */}
              {!vp?.id && (
                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 text-left max-w-xs mx-auto">
                  <Info size={12} className="shrink-0 mt-0.5" />
                  Sauvegardez le projet d'abord (bouton en haut à droite).
                </div>
              )}
              {vp?.id && (vp?.clips || []).length === 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 text-left max-w-xs mx-auto">
                  <Info size={12} className="shrink-0 mt-0.5" />
                  Ajoutez des clips via l'onglet "Médias" de la sidebar.
                </div>
              )}

              <button
                onClick={startSession}
                disabled={!canStart}
                className="btn-gold flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm mx-auto disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} />
                Lancer le montage automatique
              </button>
            </div>
          )}

          {/* Loading initial */}
          {sending && messages.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <Loader2 size={24} className="animate-spin text-primary mx-auto" />
              <p className="text-xs text-muted-foreground">L'agent analyse votre projet…</p>
            </div>
          )}

          {/* Messages de conversation */}
          {messages.map((msg, i) => {
            if (msg.role === "tool") return null;
            const isUser = msg.role === "user";
            // Masquer le long message initial de l'utilisateur
            if (isUser && i === 0) return null;
            return (
              <div key={i} className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                {!isUser && (
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={11} className="text-primary" />
                  </div>
                )}
                <div className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-foreground/80"
                }`}>
                  {isUser ? (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <ReactMarkdown className="prose prose-xs prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0.5 [&_ul]:my-1 [&_li]:my-0 [&_table]:text-xs [&_th]:text-primary [&_td]:py-0.5">
                      {msg.content}
                    </ReactMarkdown>
                  )}
                  {msg.tool_calls?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.tool_calls.map((tc, ti) => {
                        const running = tc.status === "running" || tc.status === "in_progress";
                        const done = tc.status === "completed";
                        return (
                          <div key={ti} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded px-2 py-1">
                            {running
                              ? <Loader2 size={9} className="animate-spin text-primary shrink-0" />
                              : done
                                ? <span className="text-green-400 shrink-0">✓</span>
                                : <Sparkles size={9} className="shrink-0" />
                            }
                            <span className="truncate">{
                              tc.name?.includes("VideoProject") ? "Mise à jour VideoProject" :
                              tc.name?.includes("Project") ? "Lecture projet source" :
                              tc.name?.includes("Output") ? "Lecture brief / timeline" :
                              tc.name?.split(".").pop() || tc.name
                            }</span>
                            {running && <span className="text-primary ml-auto shrink-0">en cours…</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {sending && messages.length > 0 && (
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Bot size={11} className="text-primary" />
              </div>
              <div className="bg-card border border-border rounded-xl px-3 py-2.5">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {conversationId && (
          <div className="p-3 border-t border-border shrink-0 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ex : Raccourcis les clips du milieu à 2 beats, ajoute plus de flash…"
              className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="px-3 py-2 rounded-lg btn-gold text-xs disabled:opacity-50"
            >
              <Send size={12} />
            </button>
          </div>
        )}
      </div>

      {showExporter && (
        <VideoExporter
          vp={freshVp || vp}
          sourceProject={sourceProject}
          onClose={() => setShowExporter(false)}
        />
      )}
    </>
  );
}
