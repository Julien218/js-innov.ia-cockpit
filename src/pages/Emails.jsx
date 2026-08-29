import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Mail, RefreshCw, Paperclip, Search, ArrowLeft, User, Calendar,
  Shield, Store, Send, Loader2, Reply, Trash2, Archive, Check, AlertCircle,
  FolderOpen, UploadCloud, X, FileText
} from "lucide-react";

const API_BASE = '';
const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const ACCEPTED_FILES = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv,.txt';

const IONOS_MAILBOXES = [
  { id: 'jsinnovia',  label: 'JS-Innov.IA',     email: 'info@jsinnovia.com',       icon: Mail,   color: '#D4AF37', isAlias: true,  canSend: true,  brand: 'js-innov-ia' },
  { id: 'assurances', label: 'Assurances Dour', email: 'info@assurances-dour.be', icon: Shield, color: '#22D3EE', isAlias: false, canSend: true,  brand: 'assurances-dour' },
  { id: 'store',      label: 'JS Store',         email: 'info@jsinnovia.store',    icon: Store,  color: '#A78BFA', isAlias: false, canSend: true,  brand: 'js-innov-ia' },
];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('fr-BE', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function extractSender(from) {
  if (!from) return { name: 'Inconnu', email: '' };
  const emailMatch = from.match(/<([^>]+)>/);
  const email = emailMatch?.[1] || (from.includes('@') ? from.replace(/["<>]/g, '').trim() : '');
  const name = emailMatch ? from.replace(emailMatch[0], '').replace(/"/g, '').trim() : from;
  return { name: name || email || 'Inconnu', email };
}

function cleanTextBody(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^--[^\n]+\n?/gm, '')
    .replace(/^Content-(?:Type|Transfer-Encoding|Disposition)[^\n]*\n?/gim, '')
    .replace(/^[A-Za-z0-9+/]{60,}={0,2}\s*$/gm, '')
    .replace(/^\s*charset=[^\n]*\n?/gim, '')
    .replace(/=\r?\n/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}`));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

function EmailListItem({ email, isSelected, onClick, onDelete, onArchive, sentFolder }) {
  const sender = extractSender(sentFolder ? (email.to || email.from) : email.from);
  return (
    <div
      className={`relative px-3 sm:px-4 py-3 cursor-pointer border-b border-white/5 transition-all duration-150 ${
        isSelected ? 'bg-white/10 border-l-[3px] border-l-[#D4AF37]' : 'hover:bg-white/5 border-l-[3px] border-l-transparent'
      } ${!email.seen && !sentFolder ? 'bg-white/[0.04]' : ''}`}
      onClick={onClick}
    >
      {!email.seen && !sentFolder && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full bg-[#D4AF37]" />}
      <div className="flex items-start gap-2 pl-1">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 mt-0.5">
          {sender.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-sm truncate ${!email.seen && !sentFolder ? 'font-semibold text-white' : 'font-medium text-gray-300'}`}>{sender.name}</span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap ml-2">{timeAgo(email.date)}</span>
          </div>
          <p className="text-xs truncate text-gray-300">{email.subject || '(sans objet)'}</p>
          {(email.body || email.preview) && <p className="text-[11px] text-gray-600 truncate mt-0.5">{cleanTextBody(email.body || email.preview).substring(0, 90)}</p>}
        </div>
      </div>
      {!sentFolder && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => onArchive(email.uid)} className="p-1.5 rounded-md bg-[#0B0B0F]/90 border border-white/10 text-gray-500 hover:text-cyan-400" title="Archiver"><Archive className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(email.uid)} className="p-1.5 rounded-md bg-[#0B0B0F]/90 border border-white/10 text-gray-500 hover:text-red-400" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}

function EmailDetail({ email, onBack, onReply, onDelete, onArchive, sentFolder }) {
  const sender = extractSender(email.from);
  const bodyText = cleanTextBody(email.text || '') || htmlToText(email.html || '') || cleanTextBody(email.preview || '');
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 sm:px-6 py-3 border-b border-white/10 flex items-start gap-3">
        <button onClick={onBack} className="p-2 min-w-[40px] min-h-[40px] rounded-lg hover:bg-white/10 text-gray-400"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-white leading-snug">{email.subject || '(sans objet)'}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-300"><User className="w-3 h-3 text-[#D4AF37]" /><span className="font-medium">{sender.name}</span></span>
            {email.date && <span className="flex items-center gap-1 text-xs text-gray-500"><Calendar className="w-3 h-3" /> {formatDate(email.date)}</span>}
          </div>
          {email.to && <p className="text-[11px] text-gray-500 mt-0.5 truncate">À : {email.to}</p>}
        </div>
        <div className="flex items-center gap-1">
          {!sentFolder && <button onClick={onReply} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30"><Reply className="w-3.5 h-3.5" /><span className="hidden sm:inline">Répondre</span></button>}
          {!sentFolder && <button onClick={() => onArchive(email.uid)} className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400"><Archive className="w-4 h-4" /></button>}
          {!sentFolder && <button onClick={() => onDelete(email.uid)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 overscroll-contain">
        {bodyText ? <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans break-words leading-relaxed">{bodyText}</pre> : <p className="text-sm text-gray-500 italic">Corps du message vide ou non disponible.</p>}
        {email.attachments?.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1"><Paperclip className="w-3 h-3" /> Pièces jointes ({email.attachments.length})</p>
            {email.attachments.map((a, i) => (
              <div key={`${a.filename}-${i}`} className="flex items-center gap-2 text-xs text-gray-400 py-1.5 px-3 rounded-lg bg-white/5 mb-1">
                <Paperclip className="w-3.5 h-3.5 text-[#D4AF37]" /><span className="truncate flex-1">{a.filename}</span><span className="text-gray-600">{formatBytes(a.size || 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DropboxPicker({ open, onClose, brand, selected, onChange }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError('');
    fetch(`/api/documents?brand=${encodeURIComponent(brand)}&limit=100`, { credentials: 'same-origin' })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) throw new Error(data.error || 'Coffre Dropbox indisponible');
        setDocuments(data.documents || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, brand]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(d => [d.filename, d.client_id, d.category].some(v => String(v || '').toLowerCase().includes(q)));
  }, [documents, search]);

  const toggle = (doc) => {
    const exists = selected.some(d => d.id === doc.id);
    if (exists) onChange(selected.filter(d => d.id !== doc.id));
    else if (selected.length < MAX_ATTACHMENTS) onChange([...selected, doc]);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[80vh] bg-[#16161A] border border-white/10 rounded-2xl flex flex-col shadow-2xl">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div><h4 className="text-sm font-semibold text-white flex items-center gap-2"><FolderOpen className="w-4 h-4 text-[#D4AF37]" /> Documents Dropbox</h4><p className="text-[11px] text-gray-500">Les fichiers restent dans Dropbox ; le cockpit ne charge que ceux sélectionnés.</p></div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 border-b border-white/10"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un document..." className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50" /></div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-sm text-gray-500 p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Chargement...</div>}
          {error && <div className="text-sm text-red-400 p-3 border border-red-500/20 bg-red-500/10 rounded-lg">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="text-sm text-gray-500 p-6 text-center">Aucun document indexé pour cette marque.</div>}
          {filtered.map(doc => {
            const checked = selected.some(d => d.id === doc.id);
            return (
              <button key={doc.id} type="button" onClick={() => toggle(doc)} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-colors ${checked ? 'border-[#D4AF37]/60 bg-[#D4AF37]/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                <FileText className={`w-4 h-4 flex-shrink-0 ${checked ? 'text-[#D4AF37]' : 'text-gray-500'}`} />
                <div className="min-w-0 flex-1"><p className="text-sm text-white truncate">{doc.filename}</p><p className="text-[11px] text-gray-500 truncate">{doc.category || 'documents'}{doc.client_id ? ` · ${doc.client_id}` : ''} · {formatBytes(doc.size_bytes || 0)}</p></div>
                <div className={`w-5 h-5 rounded border flex items-center justify-center ${checked ? 'bg-[#D4AF37] border-[#D4AF37] text-black' : 'border-white/20'}`}>{checked && <Check className="w-3.5 h-3.5" />}</div>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between"><span className="text-xs text-gray-500">{selected.length} sélectionné(s)</span><button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-medium">Terminer</button></div>
      </div>
    </div>
  );
}

function ComposeModal({ open, onClose, mailbox, replyTo, onSend }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [localFiles, setLocalFiles] = useState([]);
  const [dropboxDocs, setDropboxDocs] = useState([]);
  const [archiveAttachments, setArchiveAttachments] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null); setError(null); setLocalFiles([]); setDropboxDocs([]); setArchiveAttachments(true);
    if (replyTo) {
      setTo(extractSender(replyTo.from).email || replyTo.from || '');
      setSubject(replyTo.subject?.toLowerCase().startsWith('re:') ? replyTo.subject : `Re: ${replyTo.subject || ''}`);
      setBody(`\n\n---\nLe ${formatDate(replyTo.date)}, ${replyTo.from || ''} a écrit :\n\n${cleanTextBody(replyTo.text || '').substring(0, 600)}`);
    } else {
      setTo(''); setSubject(''); setBody('');
    }
  }, [open, replyTo]);

  const addLocalFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    const next = [...localFiles];
    for (const file of incoming) {
      if (file.size > MAX_LOCAL_FILE_BYTES) { setError(`${file.name} dépasse 10 Mo.`); continue; }
      if (next.length + dropboxDocs.length >= MAX_ATTACHMENTS) { setError(`Maximum ${MAX_ATTACHMENTS} pièces jointes.`); break; }
      if (!next.some(f => f.name === file.name && f.size === file.size)) next.push(file);
    }
    setLocalFiles(next);
  };

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) { setError('Destinataire, objet et message requis.'); return; }
    if (localFiles.length + dropboxDocs.length > MAX_ATTACHMENTS) { setError(`Maximum ${MAX_ATTACHMENTS} pièces jointes.`); return; }
    setSending(true); setError(null);
    try {
      const attachments = await Promise.all(localFiles.map(async file => ({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      })));
      await onSend({
        to,
        subject,
        text: body,
        attachments,
        documentIds: dropboxDocs.map(d => d.id),
        archiveAttachments,
        brand: mailbox.brand,
        category: 'emails',
        replyToMessageId: replyTo?.messageId || null,
      });
      setStatus('success');
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err.message || "Erreur d'envoi."); setStatus('error');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-[#16161A] border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[92vh]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div><h3 className="text-sm font-semibold text-white">{replyTo ? 'Répondre' : 'Nouveau message'}</h3><p className="text-[11px] text-gray-500">Depuis : {mailbox.email}</p></div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div><label className="block text-xs text-gray-400 mb-1 font-medium">À</label><input value={to} onChange={e => setTo(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50" placeholder="destinataire@email.com" /></div>
            <div><label className="block text-xs text-gray-400 mb-1 font-medium">Objet</label><input value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50" placeholder="Objet" /></div>
            <div><label className="block text-xs text-gray-400 mb-1 font-medium">Message</label><textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 resize-none" placeholder="Votre message..." /></div>

            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-200">
                  <UploadCloud className="w-4 h-4 text-[#D4AF37]" /> Ajouter un fichier
                  <input type="file" multiple accept={ACCEPTED_FILES} onChange={addLocalFiles} className="hidden" />
                </label>
                <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-200"><FolderOpen className="w-4 h-4 text-cyan-400" /> Depuis Dropbox</button>
              </div>

              {(localFiles.length > 0 || dropboxDocs.length > 0) && (
                <div className="space-y-1.5">
                  {localFiles.map((file, index) => <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-white/5"><Paperclip className="w-3.5 h-3.5 text-[#D4AF37]" /><span className="truncate flex-1 text-gray-300">{file.name}</span><span className="text-gray-600">{formatBytes(file.size)}</span><button onClick={() => setLocalFiles(localFiles.filter((_, i) => i !== index))} className="text-gray-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button></div>)}
                  {dropboxDocs.map(doc => <div key={doc.id} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10"><FolderOpen className="w-3.5 h-3.5 text-cyan-400" /><span className="truncate flex-1 text-gray-300">{doc.filename}</span><span className="text-gray-600">Dropbox</span><button onClick={() => setDropboxDocs(dropboxDocs.filter(d => d.id !== doc.id))} className="text-gray-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button></div>)}
                </div>
              )}

              {localFiles.length > 0 && (
                <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer"><input type="checkbox" checked={archiveAttachments} onChange={e => setArchiveAttachments(e.target.checked)} className="mt-0.5" /><span><strong className="text-gray-300">Archiver une copie dans Dropbox</strong><br />Recommandé pour conserver les documents envoyés dans le coffre documentaire.</span></label>
              )}
              <p className="text-[10px] text-gray-600">Formats : PDF, photos, Word, Excel, CSV, TXT. 10 Mo/fichier, 20 Mo au total, {MAX_ATTACHMENTS} pièces maximum.</p>
            </div>

            {error && <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>}
            {status === 'success' && <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-400"><Check className="w-3.5 h-3.5" /> Email envoyé.</div>}
          </div>
          <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10">Annuler</button><button onClick={handleSend} disabled={sending} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#D4AF37] text-black disabled:opacity-50">{sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{sending ? 'Envoi...' : 'Envoyer'}</button></div>
        </div>
      </div>
      <DropboxPicker open={pickerOpen} onClose={() => setPickerOpen(false)} brand={mailbox.brand} selected={dropboxDocs} onChange={setDropboxDocs} />
    </>
  );
}

export default function Emails() {
  const [activeMailbox, setActiveMailbox] = useState('assurances');
  const [googleAccounts, setGoogleAccounts] = useState([]);
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
  const [searchParams] = useSearchParams();
  const folder = searchParams.get('folder') || 'inbox';
  const isSentFolder = folder === 'sent';

  const mailboxes = useMemo(() => [
    ...IONOS_MAILBOXES,
    ...googleAccounts.filter((account) => account.active).map((account) => ({
      id: `google:${account.id}`, accountId: account.id, provider: 'google', label: account.label || account.email,
      email: account.email, icon: Mail, color: '#4285F4', isAlias: false, canSend: false, brand: account.brand || 'js-innov-ia',
    })),
  ], [googleAccounts]);
  const activeMailboxCfg = mailboxes.find(m => m.id === activeMailbox) || mailboxes[1];

  useEffect(() => {
    fetch('/api/google-mail/accounts', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((data) => { if (data.success) setGoogleAccounts(data.accounts || []); })
      .catch(() => {});
  }, []);

  const flash = (type, text) => {
    setActionMsg({ type, text });
    window.setTimeout(() => setActionMsg(null), 3000);
  };

  const fetchList = useCallback(async () => {
    if (activeMailboxCfg?.isAlias) { setEmails([]); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const endpoint = activeMailboxCfg?.provider === 'google'
        ? `${API_BASE}/api/google-mail/messages?account_id=${encodeURIComponent(activeMailboxCfg.accountId)}&folder=${isSentFolder ? 'sent' : 'inbox'}&limit=50`
        : (isSentFolder
          ? `${API_BASE}/api/emails/sent?mailbox=${activeMailbox}&limit=50`
          : `${API_BASE}/api/emails?mailbox=${activeMailbox}&limit=50`);
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur de chargement');
      setEmails(data.emails || []);
    } catch (err) {
      setError(err.message); setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [activeMailbox, activeMailboxCfg?.isAlias, activeMailboxCfg?.provider, activeMailboxCfg?.accountId, isSentFolder]);

  const fetchDetail = useCallback(async (email) => {
    setSelectedUid(email.uid);
    if (isSentFolder && activeMailboxCfg?.provider !== 'google') {
      setDetail({ ...email, text: email.preview || email.body || '' });
      return;
    }
    setLoadingDetail(true);
    try {
      const endpoint = activeMailboxCfg?.provider === 'google'
        ? `${API_BASE}/api/google-mail/messages/${encodeURIComponent(email.uid)}?account_id=${encodeURIComponent(activeMailboxCfg.accountId)}`
        : `${API_BASE}/api/emails/${email.uid}?mailbox=${activeMailbox}`;
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');
      setDetail(data.email);
      setEmails(prev => prev.map(e => e.uid === email.uid ? { ...e, seen: true } : e));
    } catch (err) {
      flash('error', err.message);
    } finally {
      setLoadingDetail(false);
    }
  }, [activeMailbox, activeMailboxCfg?.provider, activeMailboxCfg?.accountId, isSentFolder]);

  const handleDelete = async (uid) => {
    try {
      const endpoint = activeMailboxCfg?.provider === 'google'
        ? `${API_BASE}/api/google-mail/messages/${encodeURIComponent(uid)}/trash?account_id=${encodeURIComponent(activeMailboxCfg.accountId)}`
        : `${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`;
      const res = await fetch(endpoint, { method: activeMailboxCfg?.provider === 'google' ? 'POST' : 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => prev.filter(e => e.uid !== uid));
      if (selectedUid === uid) { setSelectedUid(null); setDetail(null); }
      flash('success', activeMailboxCfg?.provider === 'google' ? 'Email déplacé vers la corbeille Gmail.' : 'Email déplacé vers la corbeille.');
    } catch (err) { flash('error', `Suppression impossible : ${err.message}`); }
  };

  const handleArchive = async (uid) => {
    try {
      const endpoint = activeMailboxCfg?.provider === 'google'
        ? `${API_BASE}/api/google-mail/messages/${encodeURIComponent(uid)}/archive?account_id=${encodeURIComponent(activeMailboxCfg.accountId)}`
        : `${API_BASE}/api/emails/${uid}/archive?mailbox=${activeMailbox}`;
      const res = await fetch(endpoint, { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => activeMailboxCfg?.provider === 'google' ? prev.filter(e => e.uid !== uid) : prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
      flash('success', 'Email archivé.');
    } catch (err) { flash('error', `Archivage impossible : ${err.message}`); }
  };

  const handleSend = async (payload) => {
    if (!activeMailboxCfg?.canSend) throw new Error('Envoi non disponible pour cette boîte.');
    const res = await fetch(`${API_BASE}/api/email-compose/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ mailbox: activeMailbox, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || "Erreur d'envoi");
    flash('success', `Email envoyé${data.attachmentCount ? ` avec ${data.attachmentCount} pièce(s) jointe(s)` : ''}.`);
    fetchList();
  };

  useEffect(() => {
    fetchList(); setSelectedUid(null); setDetail(null);
  }, [fetchList]);

  const filtered = search
    ? emails.filter(e => [e.subject, e.from, e.to].some(v => String(v || '').toLowerCase().includes(search.toLowerCase())))
    : emails;
  const unreadCount = isSentFolder ? 0 : emails.filter(e => !e.seen).length;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] bg-[#0B0B0F]">
      <div className="px-3 sm:px-6 py-3 border-b border-white/8 bg-[#0F0F14] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><Mail className="w-5 h-5 text-[#D4AF37]" />{isSentFolder ? 'Emails envoyés' : 'Boîtes mail'}{unreadCount > 0 && <span className="ml-1 bg-[#D4AF37] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => { setReplyTo(null); setComposeOpen(true); }} disabled={!activeMailboxCfg?.canSend} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg min-h-[36px] border ${!activeMailboxCfg?.canSend ? 'bg-white/5 text-gray-600 border-white/10 cursor-not-allowed' : 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30 hover:bg-[#D4AF37]/25'}`}><Send className="w-3.5 h-3.5" /><span className="hidden sm:inline">Écrire</span></button>
            <button onClick={fetchList} disabled={loading} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 min-h-[36px]"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Actualiser</span></button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {mailboxes.map(mb => {
            const Icon = mb.icon; const active = activeMailbox === mb.id;
            return <button key={mb.id} onClick={() => setActiveMailbox(mb.id)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap min-h-[44px] border ${active ? 'bg-white/10 text-white border-white/20' : 'text-gray-500 hover:text-white hover:bg-white/5 border-transparent'}`} style={active ? { borderColor: `${mb.color}60` } : {}}><Icon className="w-3.5 h-3.5" style={{ color: active ? mb.color : undefined }} /><span style={active ? { color: mb.color } : {}}>{mb.label}</span>{mb.isAlias && <span className="text-[9px] bg-yellow-500/20 text-yellow-400/80 px-1 py-0.5 rounded border border-yellow-500/20">alias</span>}{mb.provider === 'google' && <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded border border-blue-500/20">Google</span>}</button>;
          })}
        </div>

        <div className="mt-3 relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher dans les emails..." className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]/40" /></div>
      </div>

      {actionMsg && <div className={`mx-3 mt-2 px-3 py-2 rounded-lg text-xs border ${actionMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>{actionMsg.text}</div>}

      {activeMailboxCfg?.isAlias ? (
        <div className="flex-1 flex items-center justify-center p-6"><div className="max-w-md text-center"><Mail className="w-10 h-10 mx-auto mb-3 text-yellow-400/70" /><h2 className="text-white font-semibold mb-2">Adresse de redirection</h2><p className="text-sm text-gray-500">{activeMailboxCfg.email} est un alias. Utilise la boîte JS Store ou Assurances Dour pour lire et envoyer des emails.</p></div></div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr]">
          <div className={`${selectedUid ? 'hidden md:block' : 'block'} border-r border-white/8 overflow-y-auto`}>
            {loading && <div className="p-8 text-center text-gray-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement...</div>}
            {error && <div className="m-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}
            {!loading && !error && filtered.length === 0 && <div className="p-8 text-center text-gray-600 text-sm">Aucun email.</div>}
            {filtered.map(email => <EmailListItem key={email.uid} email={email} isSelected={selectedUid === email.uid} sentFolder={isSentFolder} onClick={() => fetchDetail(email)} onDelete={handleDelete} onArchive={handleArchive} />)}
          </div>
          <div className={`${selectedUid ? 'block' : 'hidden md:flex'} min-w-0 bg-[#0D0D11]`}>
            {loadingDetail ? <div className="m-auto text-gray-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement...</div> : detail ? <div className="w-full"><EmailDetail email={detail} sentFolder={isSentFolder} onBack={() => { setSelectedUid(null); setDetail(null); }} onReply={() => { setReplyTo(detail); setComposeOpen(true); }} onDelete={handleDelete} onArchive={handleArchive} /></div> : <div className="m-auto text-gray-700 text-sm text-center"><Mail className="w-10 h-10 mx-auto mb-2 opacity-40" />Sélectionne un email</div>}
          </div>
        </div>
      )}

      <ComposeModal open={composeOpen} onClose={() => { setComposeOpen(false); setReplyTo(null); }} mailbox={activeMailboxCfg} replyTo={replyTo} onSend={handleSend} />
    </div>
  );
}
