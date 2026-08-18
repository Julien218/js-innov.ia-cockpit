import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Send, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

function storageKey(user) {
  const scope = user?.organisation || user?.id || 'client';
  return `jsinnovia_client_companion_${String(scope).toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
}

function defaultGreeting(user, profile) {
  if (profile?.greeting) return profile.greeting;
  const firstName = String(user?.full_name || '').trim().split(/\s+/)[0];
  return `${firstName ? `Bonjour ${firstName}` : 'Bonjour'} ! Je suis ${profile?.assistant_name || 'NOVA'}, votre assistant JS-Innov.IA. Je peux vous aider à suivre vos projets, devis, factures et demandes.`;
}

export default function ClientCompanion() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState({ assistant_name: 'NOVA', brand_name: 'JS-Innov.IA' });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const key = useMemo(() => storageKey(user), [user]);
  const conversationId = useMemo(() => `client_${String(user?.organisation || user?.id || 'main').replace(/[^a-zA-Z0-9_-]/g, '_')}`, [user]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) setMessages(saved.slice(-40));
    } catch {}
  }, [key]);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(messages.slice(-40))); } catch {}
  }, [key, messages]);

  useEffect(() => {
    let active = true;
    fetch('/api/assistant/profile', { credentials: 'same-origin' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!active || !data?.display) return;
        setProfile((current) => ({ ...current, ...data.display }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, confirmation]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const visibleMessages = messages.length ? messages : [
    { role: 'assistant', content: defaultGreeting(user, profile), ts: Date.now() },
  ];

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setConfirmation(null);
    setMessages((prev) => [...prev, { role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);
    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: text, conversation_id: conversationId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Assistant momentanément indisponible');
      if (data.display) setProfile((current) => ({ ...current, ...data.display }));
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.message || data.response || 'Je n’ai pas pu produire une réponse complète.',
        ts: Date.now(),
      }]);
      setConfirmation(data.confirmation || null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Une erreur est survenue : ${error.message}`, ts: Date.now(), error: true }]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, input, loading]);

  const confirmAction = useCallback(async () => {
    if (!confirmation || confirming) return;
    setConfirming(true);
    try {
      const response = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: confirmation.token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Action non exécutée');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Votre demande a bien été enregistrée${data.action_summary ? ` : ${data.action_summary}` : '.'}`,
        ts: Date.now(),
      }]);
      setConfirmation(null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `La demande n’a pas pu être enregistrée : ${error.message}`, ts: Date.now(), error: true }]);
    } finally {
      setConfirming(false);
    }
  }, [confirmation, confirming]);

  const clearConversation = useCallback(async () => {
    setMessages([]);
    setConfirmation(null);
    localStorage.removeItem(key);
    try {
      await fetch(`/api/assistant/history?conversation_id=${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {}
  }, [conversationId, key]);

  if (!user || user.role !== 'client') return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Ouvrir ${profile.assistant_name || 'NOVA'}`}
          className="fixed bottom-5 right-5 z-[99999] h-14 w-14 rounded-full border border-primary/50 bg-slate-950 text-primary shadow-2xl shadow-primary/20 flex items-center justify-center hover:scale-105 transition-transform"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {open && (
        <section className="fixed bottom-5 right-5 z-[99999] flex h-[560px] max-h-[calc(100vh-40px)] w-[390px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-slate-950 shadow-2xl">
          <header className="flex items-center justify-between border-b border-primary/20 bg-slate-900 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-full border border-primary/40 flex items-center justify-center text-primary"><Bot className="h-4 w-4" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-primary">{profile.assistant_name || 'NOVA'}</p>
                <p className="truncate text-[11px] text-slate-400">{profile.brand_name || 'JS-Innov.IA'} · votre assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={clearConversation} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800" title="Nouvelle conversation">↻</button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="Fermer"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {visibleMessages.map((message, index) => (
              <div
                key={`${message.ts || index}-${index}`}
                className={message.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-xl rounded-br-sm border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap'
                  : `max-w-[88%] rounded-xl rounded-bl-sm border px-3 py-2 text-sm whitespace-pre-wrap ${message.error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-900 text-slate-200'}`}
              >
                {message.content}
              </div>
            ))}

            {loading && <div className="text-xs text-slate-500">{profile.assistant_name || 'NOVA'} prépare votre réponse…</div>}

            {confirmation && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-slate-300">{confirmation.summary || 'Confirmer cette demande ?'}</p>
                <button
                  type="button"
                  onClick={confirmAction}
                  disabled={confirming}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {confirming ? 'Enregistrement…' : 'Confirmer'}
                </button>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-primary/15 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={`Écrivez à ${profile.assistant_name || 'NOVA'}…`}
                disabled={loading}
                className="min-h-10 max-h-24 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary/60"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
                title="Envoyer"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-600">Réponses limitées aux informations et services autorisés pour votre espace.</p>
          </footer>
        </section>
      )}
    </>
  );
}
