import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, CheckCircle2, Loader2, Mail, Play, RefreshCw, Send,
  ShieldCheck, Sparkles, User, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TASKS = [
  { value: "general", label: "Mission commerciale" },
  { value: "audit", label: "Audit commercial" },
  { value: "product_offer", label: "Offre produit" },
  { value: "lead_qualification", label: "Qualification d’un lead" },
  { value: "campaign", label: "Campagne" },
  { value: "email_draft", label: "Brouillon d’e-mail" },
  { value: "site_review", label: "Audit d’un site" },
  { value: "objection", label: "Réponse à une objection" },
];

async function jysiaRequest(path, options = {}) {
  const response = await fetch(`/api/jysia${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.detail || `Erreur ${response.status}`);
  return data;
}

function formatResult(result) {
  const sections = [
    result.summary,
    result.verified?.length ? `Vérifié\n• ${result.verified.join("\n• ")}` : "",
    result.assumptions?.length ? `Hypothèses\n• ${result.assumptions.join("\n• ")}` : "",
    result.recommendations?.length ? `Recommandations\n• ${result.recommendations.join("\n• ")}` : "",
    result.validation_required?.length
      ? `À valider\n• ${result.validation_required.join("\n• ")}`
      : "",
    result.draft_content ? `Brouillon\n${result.draft_content}` : "",
    result.next_action ? `Prochaine action\n${result.next_action}` : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

function StatusPill({ status }) {
  const styles = {
    pending: "bg-amber-500/10 text-amber-700",
    approved: "bg-blue-500/10 text-blue-700",
    rejected: "bg-red-500/10 text-red-700",
    executed: "bg-emerald-500/10 text-emerald-700",
    simulated: "bg-purple-500/10 text-purple-700",
    failed: "bg-red-500/10 text-red-700",
  };
  const labels = {
    pending: "En attente",
    approved: "Approuvé — non exécuté",
    rejected: "Rejeté",
    executed: "Exécuté",
    simulated: "Simulation exécutée",
    failed: "Échec",
  };
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", styles[status] || "bg-muted text-muted-foreground")}>
      {labels[status] || status}
    </span>
  );
}

function MissionPanel({ health }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Bonjour Julien. Je suis JYSIA, l’agent commercial de JS‑Innov.IA. Quelle mission commerciale veux-tu préparer ?",
    },
  ]);
  const [input, setInput] = useState("");
  const [task, setTask] = useState("general");
  const [target, setTarget] = useState("Prospects et clients JS‑Innov.IA");
  const [product, setProduct] = useState("Catalogue JS‑Innov.IA");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const mutation = useMutation({
    mutationFn: async (objective) => {
      const previousContext = messages
        .slice(-8)
        .map((message) => `${message.role === "user" ? "Julien" : "JYSIA"}: ${message.content}`)
        .join("\n\n");
      return jysiaRequest("/agent/run", {
        method: "POST",
        body: JSON.stringify({
          task,
          objective,
          target,
          product,
          context: previousContext,
        }),
      });
    },
    onSuccess: (result) => {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: formatResult(result), risk: result.risk_level },
      ]);
    },
    onError: (error) => {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `JYSIA est indisponible : ${error.message}`, error: true },
      ]);
    },
  });

  const send = () => {
    const objective = input.trim();
    if (objective.length < 3 || mutation.isPending) return;
    setMessages((current) => [...current, { role: "user", content: objective }]);
    setInput("");
    mutation.mutate(objective);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
      <section className="bg-card border border-border rounded-2xl overflow-hidden min-h-[620px] flex flex-col">
        <div className="px-5 py-4 bg-[#001a3d] text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">JYSIA</h2>
            <p className="text-xs text-white/60">Commercialisation et croissance · supervision humaine</p>
          </div>
          <span className={cn(
            "text-[11px] rounded-full px-2.5 py-1",
            health?.status === "ok" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-200"
          )}>
            {health?.status === "ok" ? "Prête" : "Configuration incomplète"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-muted/25 space-y-4">
          {messages.map((message, index) => {
            const mine = message.role === "user";
            return (
              <div key={index} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                  mine ? "bg-muted text-muted-foreground" : "bg-[#001a3d] text-[#D4AF37]"
                )}>
                  {mine ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={cn(
                  "max-w-[84%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed",
                  mine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border border-border rounded-tl-sm",
                  message.error && "border-red-300 text-red-700"
                )}>
                  {message.content}
                </div>
              </div>
            );
          })}
          {mutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> JYSIA prépare une réponse structurée…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-border bg-card">
          <div className="flex gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ex. Qualifie ce prospect et prépare la prochaine action…"
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={mutation.isPending}
            />
            <Button onClick={send} disabled={mutation.isPending || input.trim().length < 3} className="self-end h-10">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </section>

      <aside className="bg-card border border-border rounded-2xl p-4 h-fit space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Type de mission</label>
          <select
            value={task}
            onChange={(event) => setTask(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {TASKS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Cible</label>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            maxLength={500}
            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Produit</label>
          <input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            maxLength={500}
            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-emerald-700 flex items-center gap-1.5 mb-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Validation humaine active
          </p>
          JYSIA peut préparer une action, mais elle ne peut pas envoyer un e-mail directement.
        </div>
      </aside>
    </div>
  );
}

function ApprovalsPanel() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["jysia-approvals", filter],
    queryFn: () => jysiaRequest(`/approvals?${new URLSearchParams({ status: filter, limit: "100" })}`),
    refetchInterval: 30_000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, reason }) => jysiaRequest(`/approvals/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jysia-approvals"] }),
  });

  const decide = (item, action) => {
    if (action === "reject") {
      const reason = window.prompt("Motif du rejet (facultatif) :") || "";
      actionMutation.mutate({ id: item.id, action, reason });
      return;
    }
    const text = action === "execute"
      ? "Confirmer l’exécution de cette action ? En staging, DRY_RUN doit rester actif."
      : "Approuver cette action sans l’exécuter ?";
    if (window.confirm(text)) actionMutation.mutate({ id: item.id, action });
  };

  const totals = useMemo(() => ({
    visible: data.length,
    emails: data.filter((item) => item.action_type === "email").length,
  }), [data]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["pending", "approved", "executed", "simulated", "rejected"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border",
              filter === status ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
            )}
          >
            {status === "pending" ? "En attente" :
             status === "approved" ? "Approuvés" :
             status === "executed" ? "Exécutés" :
             status === "simulated" ? "Simulés" : "Rejetés"}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-auto">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Actualiser
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {totals.visible} action(s) · {totals.emails} e-mail(s)
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Chargement…
        </div>
      ) : isError ? (
        <div className="p-5 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
          {error.message}
        </div>
      ) : data.length === 0 ? (
        <div className="p-12 rounded-2xl border border-border bg-card text-center">
          <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto mb-2 opacity-60" />
          <p className="text-sm text-muted-foreground">Aucune action dans cette catégorie.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((item) => {
            const payload = item.payload || {};
            const preview = payload.text || payload.html || "";
            return (
              <article key={item.id} className="bg-card border border-border rounded-2xl p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm">{payload.subject || "Action JYSIA"}</h3>
                      <StatusPill status={item.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      À : {Array.isArray(payload.to) ? payload.to.join(", ") : "—"}
                    </p>
                    {payload.cc?.length > 0 && (
                      <p className="text-xs text-muted-foreground">Cc : {payload.cc.join(", ")}</p>
                    )}
                    <div className="mt-3 max-h-52 overflow-y-auto rounded-xl bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
                      {preview || "Aucun aperçu texte."}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Demandé par {item.requested_by} · identifiant {item.id}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {item.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => decide(item, "approve")} disabled={actionMutation.isPending}>
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approuver
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(item, "reject")} disabled={actionMutation.isPending}>
                          <XCircle className="w-3.5 h-3.5 mr-1.5" /> Rejeter
                        </Button>
                      </>
                    )}
                    {item.status === "approved" && (
                      <Button size="sm" onClick={() => decide(item, "execute")} disabled={actionMutation.isPending}>
                        <Play className="w-3.5 h-3.5 mr-1.5" /> Exécuter
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {actionMutation.isError && (
        <p className="text-sm text-red-600">{actionMutation.error.message}</p>
      )}
    </section>
  );
}

export default function Jysia() {
  const [tab, setTab] = useState("mission");
  const healthQuery = useQuery({
    queryKey: ["jysia-health"],
    queryFn: () => jysiaRequest("/health"),
    retry: false,
    refetchInterval: 30_000,
  });

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#001a3d] flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <div>
          <h1 className="text-xl font-bold">JYSIA</h1>
          <p className="text-xs text-muted-foreground">Agent commercial et croissance de JS‑Innov.IA</p>
        </div>
        <div className="ml-auto text-xs">
          {healthQuery.isLoading ? (
            <span className="text-muted-foreground">Connexion…</span>
          ) : healthQuery.isError ? (
            <span className="text-red-600">Non configurée</span>
          ) : (
            <span className={healthQuery.data.status === "ok" ? "text-emerald-600" : "text-amber-600"}>
              {healthQuery.data.status === "ok" ? "Service prêt" : "Service en attente de clés"}
            </span>
          )}
        </div>
      </header>

      <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab("mission")}
          className={cn("px-4 py-2 rounded-lg text-sm font-medium", tab === "mission" && "bg-card shadow-sm")}
        >
          <Bot className="w-4 h-4 inline mr-1.5" /> Missions
        </button>
        <button
          onClick={() => setTab("approvals")}
          className={cn("px-4 py-2 rounded-lg text-sm font-medium", tab === "approvals" && "bg-card shadow-sm")}
        >
          <ShieldCheck className="w-4 h-4 inline mr-1.5" /> Validations JYSIA
        </button>
      </div>

      {tab === "mission"
        ? <MissionPanel health={healthQuery.data} />
        : <ApprovalsPanel />}
    </div>
  );
}
