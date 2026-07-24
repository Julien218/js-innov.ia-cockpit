import React, { useState, useEffect, useCallback } from "react";
import {
  Mail, RefreshCw, Paperclip, Search, ArrowLeft, User, Calendar,
  Shield, Store, Send, Loader2, Reply, Trash2, Archive, Check, AlertCircle,
  MailOpen
} from "lucide-react";
import { AGENT_KEY } from '@/config/agent';

const API_BASE = '';
const API_KEY = AGENT_KEY;

const MAILBOXES = [
  { id: 'jsinnovia',  label: 'JS-Innov.IA',     email: 'info@jsinnovia.com',      icon: Mail,   color: '#D4AF37', isAlias: true,  canSend: false },
  { id: 'assurances', label: 'Assurances Dour', email: 'info@assurances-dour.be', icon: Shield, color: '#22D3EE', isAlias: false, canSend: true  },
  { id: 'store',      label: 'JS Store',         email: 'info@jsinnovia.store',    icon: Store,  color: '#A78BFA', isAlias: false, canSend: true  },
];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "a l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('fr-BE', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function extractSender(from) {
  if (!from) return { name: 'Inconnu', email: '' };
  const match = from.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (match) return { name: match[1].trim() || match[2], email: match[2] };
  return { name: from, email: from };
}

function cleanTextBody(raw) {
  if (!raw) return '';
  return raw
    .replace(/^--[^\n]+\n?/gm, '')
    .replace(/^Content-(?:Type|Transfer-Encoding|Disposition)[^\n]*\n?/gim, '')
    .replace(/^[A-Za-z0-9+/]{60,}={0,2}\s*$/gm, '')
    .replace(/^\s*charset=[^\n]*\n?/gim, '')
    .replace(/=\r?\n/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function EmailListItem({ email, isSelected, onClick, onDelete, onArchive }) {
  const sender = extractSender(email.from);
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`relative px-3 sm:px-4 py-3 cursor-pointer border-b border-white/5 transition-all duration-150 ${
        isSelected ? 'bg-white/10 border-l-[3px] border-l-[#D4AF37]' : 'hover:bg-white/5 border-l-[3px] border-l-transparent'
      } ${!email.seen ? 'bg-white/[0.04]' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!email.seen && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full bg-[#D4AF37]" />
      )}
      <div className="flex items-start gap-2 pl-1">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 mt-0.5">
          {sender.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-sm truncate ${!email.seen ? 'font-semibold text-white' : 'font-medium text-gray-300'}`}>
              {sender.name}
            </span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap ml-2 flex-shrink-0">{timeAgo(email.date)}</span>
          </div>
          <p className={`text-xs truncate ${!email.seen ? 'text-gray-100' : 'text-gray-400'}`}>
            {email.subject || '(sans objet)'}
          </p>
          {email.body && (
            <p className="text-[11px] text-gray-600 truncate mt-0.5">
              {cleanTextBody(email.body).substring(0, 80)}
            </p>
          )}
        </div>
      </div>
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 transition-opacity ${showActions ? 'opacity-100' : 'opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => onArchive(email.uid)}
          className="p-1.5 rounded-md bg-[#0B0B0F]/90 border border-white/10 text-gray-500 hover:text-cyan-400 hover:border-cyan-400/30 transition-colors"
          title="Archiver"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(email.uid)}
          className="p-1.5 rounded-md bg-[#0B0B0F]/90 border border-white/10 text-gray-500 hover:text-red-400 hover:border-red-400/30 transition-colors"
          title="Supprimer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmailDetail({ email, onBack, onReply, onDelete, onArchive }) {
  const sender = extractSender(email.from);
  const bodyText = cleanTextBody(email.text || '');

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 sm:px-6 py-3 border-b border-white/10 flex items-start gap-3">
        <button
          onClick={onBack}
          className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-white leading-snug">{email.subject || '(sans objet)'}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-300">
              <User className="w-3 h-3 flex-shrink-0 text-[#D4AF37]" />
              <span className="font-medium">{sender.name}</span>
              {sender.email && sender.email !== sender.name && (
                <span className="text-gray-500 hidden sm:inline">({sender.email})</span>
              )}
            </span>
            {email.date && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Calendar className="w-3 h-3" /> {formatDate(email.date)}
              </span>
            )}
          </div>
          {email.to && <p className="text-[11px] text-gray-500 mt-0.5 truncate">A : {email.to}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onReply}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 border border-[#D4AF37]/30 transition-all min-h-[36px]"
          >
            <Reply className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Repondre</span>
          </button>
          <button
            onClick={() => onArchive(email.uid)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title="Archiver"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(email.uid)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title="Supprimer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 overscroll-contain">
        {email.html ? (
          <div
            className="prose prose-invert max-w-none text-sm text-gray-200 break-words leading-relaxed"
            dangerouslySetInnerHTML={{ __html: email.html }}
          />
        ) : bodyText ? (
          <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans break-words leading-relaxed">{bodyText}</pre>
        ) : (
          <p className="text-sm text-gray-500 italic">Corps du message vide ou non disponible.</p>
        )}
        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1">
              <Paperclip className="w-3 h-3" /> Pieces jointes ({email.attachments.length})
            </p>
            {email.attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-400 py-1.5 px-3 rounded-lg bg-white/5 mb-1">
                <Paperclip className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span className="truncate flex-1">{a.filename}</span>
                <span className="text-gray-600 flex-shrink-0">{Math.round((a.size || 0) / 1024)} KB</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComposeModal({ open, onClose, mailbox, mailboxLabel, fromEmail, replyTo, onSend }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setStatus(null); setError(null);
      if (replyTo) {
        setTo(extractSender(replyTo.from).email || replyTo.from || '');
        setSubject(replyTo.subject?.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject || ''}`);
        setBody(`\n\n---\nLe ${formatDate(replyTo.date)}, ${replyTo.from || ''} a ecrit :\n\n${cleanTextBody(replyTo.text || '').substring(0, 400)}`);
      } else { setTo(''); setSubject(''); setBody(''); }
    }
  }, [open, replyTo]);

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) { setError('Destinataire, objet et message requis.'); return; }
    setSending(true); setError(null);
    try {
      await onSend({ to, subject, text: body, replyToUid: replyTo?.uid });
      setStatus('success');
      setTimeout(onClose, 1200);
    } catch (err) { setError(err.message || "Erreur d'envoi."); setStatus('error'); }
    finally { setSending(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#16161A] border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white">{replyTo ? 'Repondre' : 'Nouveau message'}</h3>
            <p className="text-[11px] text-gray-500">Depuis : {fromEmail}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors text-lg leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">A</label>
            <input value={to} onChange={e => setTo(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none" placeholder="destinataire@email.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Objet</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none" placeholder="Objet" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none resize-none" placeholder="Votre message..." />
          </div>
          {error && <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}</div>}
          {status === 'success' && <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-400"><Check className="w-3.5 h-3.5" /> Envoye !</div>}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors">Annuler</button>
          <button onClick={handleSend} disabled={sending} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#D4AF37] text-black hover:bg-[#D4AF37]/90 disabled:opacity-50 transition-all">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? 'Envoi...' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Emails() {
  const [activeMailbox, setActiveMailbox] = useState('assurances');
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUid, setSelectedUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  const activeMailboxCfg = MAILBOXES.find(m => m.id === activeMailbox);

  const flash = (type, text) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3000);
  };

  const fetchList = useCallback(async () => {
    if (activeMailboxCfg?.isAlias) { setEmails([]); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/emails?mailbox=${activeMailbox}&limit=50`, { headers: { 'x-agent-key': API_KEY } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur de chargement');
      setEmails(data.emails || []);
    } catch (err) { setError(err.message); setEmails([]); }
    finally { setLoading(false); }
  }, [activeMailbox, activeMailboxCfg]);

  const fetchDetail = useCallback(async (uid) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`, { headers: { 'x-agent-key': API_KEY } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');
      setDetail(data.email);
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
    } catch (err) { flash('error', err.message); }
    finally { setLoadingDetail(false); }
  }, [activeMailbox]);

  const handleDelete = async (uid) => {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`, { method: 'DELETE', headers: { 'x-agent-key': API_KEY } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => prev.filter(e => e.uid !== uid));
      if (selectedUid === uid) { setSelectedUid(null); setDetail(null); }
      flash('success', 'Email supprime.');
    } catch (err) { flash('error', 'Suppression impossible : ' + err.message); }
  };

  const handleArchive = async (uid) => {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}/archive?mailbox=${activeMailbox}`, { method: 'POST', headers: { 'x-agent-key': API_KEY } });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
      flash('success', 'Archive.');
    } catch (err) { flash('error', 'Archivage impossible : ' + err.message); }
  };

  const handleSend = async ({ to, subject, text, replyToUid }) => {
    if (activeMailboxCfg?.isAlias) throw new Error('Alias - envoi non disponible.');
    const res = await fetch(`${API_BASE}/api/emails/send`, {
      method: 'POST',
      headers: { 'x-agent-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox: activeMailbox, to, subject, text, replyToUid }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Erreur d'envoi");
    fetchList();
  };

  useEffect(() => { fetchList(); setSelectedUid(null); setDetail(null); }, [fetchList]);

  const filtered = search
    ? emails.filter(e => e.subject?.toLowerCase().includes(search.toLowerCase()) || e.from?.toLowerCase().includes(search.toLowerCase()))
    : emails;

  const unreadCount = emails.filter(e => !e.seen).length;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] bg-[#0B0B0F]">

      {/* Header */}
      <div className="px-3 sm:px-6 py-3 border-b border-white/8 bg-[#0F0F14] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#D4AF37]" />
            Boites mail
            {unreadCount > 0 && (
              <span className="ml-1 bg-[#D4AF37] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setReplyTo(null); setComposeOpen(true); }}
              disabled={activeMailboxCfg?.isAlias}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all min-h-[36px] border ${
                activeMailboxCfg?.isAlias
                  ? 'bg-white/5 text-gray-600 border-white/10 cursor-not-allowed'
                  : 'bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 border-[#D4AF37]/30'
              }`}
              title={activeMailboxCfg?.isAlias ? 'Alias - envoi non disponible' : 'Ecrire'}
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ecrire</span>
            </button>
            <button
              onClick={fetchList} disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 min-h-[36px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualiser</span>
            </button>
          </div>
        </div>

        {/* Selecteur boites */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {MAILBOXES.map((mb) => {
            const Icon = mb.icon;
            const isActive = activeMailbox === mb.id;
            return (
              <button
                key={mb.id}
                onClick={() => setActiveMailbox(mb.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap min-h-[44px] border ${
                  isActive ? 'bg-white/10 text-white border-white/20' : 'text-gray-500 hover:text-white hover:bg-white/5 border-transparent'
                }`}
                style={isActive ? { borderColor: mb.color + '60', boxShadow: `0 0 0 1px ${mb.color}25` } : {}}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isActive ? mb.color : undefined }} />
                <span style={isActive ? { color: mb.color } : {}}>{mb.label}</span>
                {mb.isAlias && (
                  <span className="text-[9px] bg-yellow-500/20 text-yellow-400/80 px-1 py-0.5 rounded font-medium border border-yellow-500/20">alias</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Flash */}
      {actionMsg && (
        <div className={`mx-3 sm:mx-6 mt-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
          actionMsg.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {actionMsg.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {actionMsg.text}
        </div>
      )}

      {/* Alias info */}
      {activeMailboxCfg?.isAlias && (
        <div className="mx-3 sm:mx-6 mt-3 bg-amber-500/8 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">📬</span>
            <div>
              <p className="text-sm font-semibold text-amber-400">Alias de redirection</p>
              <p className="text-xs text-amber-400/70 mt-1">
                {activeMailboxCfg.email} est une adresse de redirection, pas une boite IMAP.<br />
                Selectionnez <strong className="text-amber-300">Assurances Dour</strong> ou <strong className="text-amber-300">JS Store</strong> pour lire et envoyer des emails.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Erreur IMAP */}
      {error && !activeMailboxCfg?.isAlias && (
        <div className="mx-3 sm:mx-6 mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
          <p className="font-semibold mb-1 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Erreur de connexion</p>
          <p className="text-xs">{error}</p>
          <p className="text-xs text-gray-500 mt-2">Variable Railway requise : EMAIL_PASSWORD{activeMailbox === 'assurances' ? '_ASSURANCES' : activeMailbox === 'store' ? '_STORE' : ''}</p>
        </div>
      )}

      {/* Corps */}
      {!activeMailboxCfg?.isAlias && !error && (
        <div className="flex flex-1 overflow-hidden">

          {/* Liste */}
          <div className={`flex flex-col ${detail ? 'hidden sm:flex sm:w-80 lg:w-96' : 'w-full'} border-r border-white/8 overflow-hidden`}>
            <div className="px-3 py-2 border-b border-white/8 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/40 focus:outline-none"
                />
              </div>
            </div>
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-sm gap-2 py-10">
                <MailOpen className="w-8 h-8 text-gray-700" />
                Aucun email
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {filtered.map(email => (
                  <EmailListItem
                    key={email.uid}
                    email={email}
                    isSelected={selectedUid === email.uid}
                    onClick={() => { setSelectedUid(email.uid); fetchDetail(email.uid); }}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail */}
          <div className={`flex-1 overflow-hidden ${detail ? 'flex' : 'hidden sm:flex'} flex-col`}>
            {loadingDetail ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" />
              </div>
            ) : detail ? (
              <EmailDetail
                email={detail}
                onBack={() => { setDetail(null); setSelectedUid(null); }}
                onReply={() => { setReplyTo(detail); setComposeOpen(true); }}
                onDelete={async (uid) => { await handleDelete(uid); setDetail(null); setSelectedUid(null); }}
                onArchive={async (uid) => { await handleArchive(uid); setDetail(null); setSelectedUid(null); }}
              />
            ) : (
              <div className="flex-1 hidden sm:flex flex-col items-center justify-center text-gray-700 gap-2">
                <Mail className="w-10 h-10" />
                <p className="text-sm">Selectionnez un email</p>
              </div>
            )}
          </div>
        </div>
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyTo(null); }}
        mailbox={activeMailbox}
        mailboxLabel={activeMailboxCfg?.label}
        fromEmail={activeMailboxCfg?.email}
        replyTo={replyTo}
        onSend={handleSend}
      />
    </div>
  );
}
