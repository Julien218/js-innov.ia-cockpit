import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Mail, RefreshCw, Paperclip, Search, ArrowLeft, User, Calendar,
  Shield, Store, Send, Loader2, Reply, Trash2, Archive, Check, AlertCircle,
  MailOpen, Forward, Printer, Download, X, FileText, Image as ImageIcon,
  File
} from "lucide-react";

const API_BASE = '';

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

function fileIcon(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return ImageIcon;
  if (['pdf'].includes(ext)) return FileText;
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileText;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return File;
  if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) return File;
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return File;
  return File;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Email List Item ───────────────────────────────────────────────────────────
function EmailListItem({ email, isSelected, onClick, onDelete, onArchive }) {
  const sender = extractSender(email.from);
  const [showActions, setShowActions] = useState(false);
  const hasAttach = email.attachments && email.attachments.length > 0;

  return (
    <div
      className={`relative px-3 sm:px-4 py-3 cursor-pointer border-b border-gray-100 transition-all duration-150 ${
        isSelected ? 'bg-[#D4AF37]/8 border-l-[3px] border-l-[#D4AF37]' : 'hover:bg-gray-100 border-l-[3px] border-l-transparent'
      } ${!email.seen ? 'bg-amber-50/40' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!email.seen && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full bg-[#D4AF37]" />
      )}
      <div className="flex items-start gap-2 pl-1">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#D4AF37]/8 flex items-center justify-center text-xs font-bold text-gray-900/60 mt-0.5">
          {sender.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-sm truncate ${!email.seen ? 'font-semibold text-gray-900' : 'font-medium text-gray-400'}`}>
              {sender.name}
            </span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap ml-2 flex-shrink-0">{timeAgo(email.date)}</span>
          </div>
          <div className="flex items-center gap-1">
            {hasAttach && <Paperclip className="w-3 h-3 text-[#D4AF37]/70 flex-shrink-0" />}
            <p className={`text-xs truncate ${!email.seen ? 'text-gray-800' : 'text-gray-500'}`}>
              {email.subject || '(sans objet)'}
            </p>
          </div>
          {email.body && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">
              {cleanTextBody(email.body).substring(0, 80)}
            </p>
          )}
        </div>
      </div>
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 transition-opacity ${showActions ? 'opacity-100' : 'opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={() => onArchive(email.uid)} className="p-1.5 rounded-md bg-gray-50/90 border border-gray-200 text-gray-400 hover:text-cyan-600 hover:border-cyan-300 transition-colors" title="Archiver">
          <Archive className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(email.uid)} className="p-1.5 rounded-md bg-gray-50/90 border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors" title="Supprimer">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Email Detail View ─────────────────────────────────────────────────────────
function EmailDetail({ email, onBack, onReply, onForward, onPrint, onDelete, onArchive, mailboxId }) {
  const sender = extractSender(email.from);
  const bodyText = cleanTextBody(email.text || '');
  const printRef = useRef(null);

  const handlePrint = () => {
    if (onPrint) onPrint();
    const printHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${email.subject || 'Email'}</title>
    <style>
      @page { margin: 2cm; }
      body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 0; color: #222; line-height: 1.6; }
      .header { border-bottom: 2px solid #D4AF37; padding-bottom: 16px; margin-bottom: 20px; }
      .header h2 { font-size: 20px; margin: 0 0 8px 0; }
      .meta { font-size: 12px; color: #666; }
      .meta strong { color: #333; }
      .body { white-space: pre-wrap; font-size: 14px; }
      .attachments { margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px; }
      .att { font-size: 12px; color: #666; padding: 4px 0; }
      .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
    </style></head><body>
    <div class="header">
      <h2>${email.subject || '(sans objet)'}</h2>
      <div class="meta"><strong>De:</strong> ${email.from || '—'}<br><strong>Date:</strong> ${formatDate(email.date)}<br><strong>À:</strong> ${email.to || '—'}</div>
    </div>
    <div class="body">${bodyText || '(corps vide)'}</div>
    ${email.attachments?.length > 0 ? `<div class="attachments"><strong>Pièces jointes (${email.attachments.length}):</strong><br>${email.attachments.map(a => `<div class="att">\u00F0\u009F\u0093\u008E ${a.filename} (${formatSize(a.size)})</div>`).join('')}</div>` : ''}
    <div class="footer">JS-Innov.IA Cockpit — Email imprimé le ${formatDate(new Date().toISOString())}</div>
    </body></html>`;

    // Utiliser une iframe cachée au lieu de window.open (évite l'ouverture d'une app externe)
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHTML);
    doc.close();
    // Attendre que le contenu soit rendu puis imprimer
    iframe.contentWindow.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Nettoyer l'iframe après l'impression
      setTimeout(() => { document.body.removeChild(iframe); }, 2000);
    };
    // Fallback si onload ne se déclenche pas (content déjà écrit)
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch(e) { /* déjà imprimé ou fenêtre fermée */ }
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 2000);
    }, 500);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 sm:px-6 py-3 border-b border-gray-200 flex items-start gap-3">
        <button onClick={onBack} className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[#D4AF37]/8 text-gray-500 hover:text-gray-900 transition-colors flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-gray-900 leading-snug">{email.subject || '(sans objet)'}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <User className="w-3 h-3 flex-shrink-0 text-[#D4AF37]" />
              <span className="font-medium">{sender.name}</span>
              {sender.email && sender.email !== sender.name && <span className="text-gray-500 hidden sm:inline">({sender.email})</span>}
            </span>
            {email.date && <span className="flex items-center gap-1 text-xs text-gray-500"><Calendar className="w-3 h-3" /> {formatDate(email.date)}</span>}
          </div>
          {email.to && <p className="text-[11px] text-gray-500 mt-0.5 truncate">À : {email.to}</p>}
        </div>
        {/* Action bar */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onReply} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 border border-[#D4AF37]/40 transition-all min-h-[36px]" title="Répondre">
            <Reply className="w-3.5 h-3.5" /><span className="hidden lg:inline">Répondre</span>
          </button>
          <button onClick={onForward} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-400 hover:bg-[#D4AF37]/8 hover:text-gray-900 border border-gray-200 transition-all min-h-[36px]" title="Transférer">
            <Forward className="w-3.5 h-3.5" /><span className="hidden lg:inline">Transférer</span>
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-400 hover:bg-[#D4AF37]/8 hover:text-gray-900 border border-gray-200 transition-all min-h-[36px]" title="Imprimer / PDF">
            <Printer className="w-3.5 h-3.5" /><span className="hidden lg:inline">Imprimer</span>
          </button>
          <div className="w-px h-6 bg-[#D4AF37]/8 mx-0.5" />
          <button onClick={() => onArchive(email.uid)} className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center" title="Archiver">
            <Archive className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(email.uid)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-400/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center" title="Supprimer">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={printRef} className="flex-1 overflow-y-auto p-4 sm:p-6 overscroll-contain">
        {email.html ? (
          <div className="prose max-w-none text-sm text-gray-800 break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: email.html }} />
        ) : bodyText ? (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans break-words leading-relaxed">{bodyText}</pre>
        ) : (
          <p className="text-sm text-gray-500 italic">Corps du message vide ou non disponible.</p>
        )}

        {/* Attachments — downloadable */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-[#D4AF37]" /> Pièces jointes ({email.attachments.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {email.attachments.map((a, i) => {
                const Icon = fileIcon(a.filename);
                return (
                  <a
                    key={i}
                    href={`${API_BASE}/api/emails/${email.uid}/attachments/${i}?mailbox=${mailboxId}`}
                    download={a.filename || `attachment-${i}`}
                    className="flex items-center gap-3 text-xs text-gray-400 py-2.5 px-3 rounded-lg bg-gray-100 hover:bg-[#D4AF37]/8 border border-gray-100 hover:border-[#D4AF37]/40 transition-all group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-gray-300 group-hover:text-gray-900">{a.filename || `attachment-${i}`}</p>
                      <p className="text-[10px] text-gray-500">{formatSize(a.size || a.filesize)} · {a.contentType || a.content_type || 'fichier'}</p>
                    </div>
                    <Download className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#D4AF37] flex-shrink-0" />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compose Modal (avec pièces jointes) ───────────────────────────────────────
function ComposeModal({ open, onClose, fromEmail, replyTo, forwardTo, onSend }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setStatus(null); setError(null);
      if (replyTo) {
        setAttachments([]);
        setTo(extractSender(replyTo.from).email || replyTo.from || '');
        setSubject(replyTo.subject?.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject || ''}`);
        setBody(`\n\n---\nLe ${formatDate(replyTo.date)}, ${replyTo.from || ''} a écrit :\n\n${cleanTextBody(replyTo.text || '').substring(0, 400)}`);
      } else if (forwardTo) {
        // Pré-charger les pièces jointes de l'email transféré
        const fwdAttachments = (forwardTo.attachments || [])
          .filter(a => a.content_base64)
          .map(a => ({
            filename: a.filename || 'attachment',
            content_base64: a.content_base64,
            content_type: a.contentType || 'application/octet-stream',
            size: a.size || 0,
          }));
        setAttachments(fwdAttachments);
        setTo('');
        setSubject(forwardTo.subject?.startsWith('Fwd:') ? forwardTo.subject : `Fwd: ${forwardTo.subject || ''}`);
        setBody(`\n\n---------- Message transféré ----------\nDe: ${forwardTo.from || ''}\nDate: ${formatDate(forwardTo.date)}\nObjet: ${forwardTo.subject || ''}\n\n${cleanTextBody(forwardTo.text || '').substring(0, 1000)}\n\n----------------------------------------\n`);
      } else {
        setAttachments([]);
        setTo(''); setSubject(''); setBody('');
      }
    }
  }, [open, replyTo, forwardTo]);

  const filesToBase64 = async (files) => {
    const results = [];
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) { setError(`"${file.name}" dépasse 15 MB`); continue; }
      const b64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
      results.push({ filename: file.name, content_base64: b64, content_type: file.type || 'application/octet-stream', size: file.size });
    }
    return results;
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError(null);
    const parsed = await filesToBase64(files);
    setAttachments(prev => [...prev, ...parsed]);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    setError(null);
    const parsed = await filesToBase64(files);
    setAttachments(prev => [...prev, ...parsed]);
  };

  const removeAttachment = (i) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  const totalSize = attachments.reduce((s, a) => s + (a.size || 0), 0);

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) { setError('Destinataire, objet et message requis.'); return; }
    if (totalSize > 20 * 1024 * 1024) { setError('Total des pièces jointes > 20 MB.'); return; }
    setSending(true); setError(null);
    try {
      await onSend({ to, subject, text: body, replyToUid: replyTo?.uid, attachments: attachments.length > 0 ? attachments : undefined });
      setStatus('success');
      setTimeout(() => onClose(), 1200);
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-2xl bg-white sm:rounded-2xl border border-gray-200 shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            {replyTo ? 'Répondre' : forwardTo ? 'Transférer' : 'Nouveau message'}
          </h3>
          <div className="flex items-center gap-2">
            {fromEmail && <span className="text-[10px] text-gray-500 hidden sm:inline">De: {fromEmail}</span>}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#D4AF37]/8 text-gray-500 hover:text-gray-900 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Destinataire</label>
            <input value={to} onChange={e => setTo(e.target.value)} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none" placeholder="email@exemple.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Objet</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none" placeholder="Objet du message" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none resize-none" placeholder="Votre message..." />
          </div>

          {/* Attachment zone */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Pièces jointes</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
                dragOver ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-gray-200 hover:border-[#D4AF37]/40 hover:bg-gray-100'
              }`}
            >
              <Paperclip className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-xs text-gray-500">Glisser des fichiers ici ou cliquer pour parcourir (max 15 MB/fichier, 20 MB total)</span>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.csv" />
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((a, i) => {
                  const Icon = fileIcon(a.filename);
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 border border-gray-100 text-xs">
                      <Icon className="w-3.5 h-3.5 text-[#D4AF37] flex-shrink-0" />
                      <span className="truncate flex-1 text-gray-400">{a.filename}</span>
                      <span className="text-gray-500 flex-shrink-0">{formatSize(a.size)}</span>
                      <button onClick={() => removeAttachment(i)} className="p-0.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-600 transition-colors flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}</div>}
          {status === 'success' && <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-600"><Check className="w-3.5 h-3.5" /> Envoyé !</div>}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-between items-center gap-2">
          <div className="text-[10px] text-gray-400 hidden sm:block">
            {attachments.length > 0 ? `${attachments.length} fichier(s) · ${formatSize(totalSize)}` : 'Aucune pièce jointe'}
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:bg-[#D4AF37]/8 transition-colors">Annuler</button>
            <button onClick={handleSend} disabled={sending} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#D4AF37] text-black hover:bg-[#D4AF37]/90 disabled:opacity-50 transition-all">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Envoi...' : 'Envoyer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
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
  const [forwardTo, setForwardTo] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [searchParams] = useSearchParams();
  const folder = searchParams.get("folder") || "inbox";
  const isSentFolder = folder === "sent";

  const activeMailboxCfg = MAILBOXES.find(m => m.id === activeMailbox);

  const flash = (type, text) => { setActionMsg({ type, text }); setTimeout(() => setActionMsg(null), 3000); };

  const fetchList = useCallback(async () => {
    if (activeMailboxCfg?.isAlias) { setEmails([]); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const endpoint = isSentFolder ? `${API_BASE}/api/emails/sent?mailbox=${activeMailbox}&limit=50` : `${API_BASE}/api/emails?mailbox=${activeMailbox}&limit=50`;
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur de chargement');
      setEmails(data.emails || []);
    } catch (err) { setError(err.message); setEmails([]); }
    finally { setLoading(false); }
  }, [activeMailbox, activeMailboxCfg]);

  const fetchDetail = useCallback(async (uid) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');
      setDetail(data.email);
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
    } catch (err) { flash('error', err.message); }
    finally { setLoadingDetail(false); }
  }, [activeMailbox]);

  const handleDelete = async (uid) => {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`, { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => prev.filter(e => e.uid !== uid));
      if (selectedUid === uid) { setSelectedUid(null); setDetail(null); }
      flash('success', 'Email supprimé.');
    } catch (err) { flash('error', 'Suppression impossible : ' + err.message); }
  };

  const handleArchive = async (uid) => {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}/archive?mailbox=${activeMailbox}`, { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
      flash('success', 'Archivé.');
    } catch (err) { flash('error', 'Archivage impossible : ' + err.message); }
  };

  const handleSend = async ({ to, subject, text, replyToUid, attachments }) => {
    if (activeMailboxCfg?.isAlias) throw new Error('Alias — envoi non disponible.');
    const res = await fetch(`${API_BASE}/api/emails/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ mailbox: activeMailbox, to, subject, text, replyToUid, attachments }),
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
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] bg-gray-50">
      {/* Header */}
      <div className="px-3 sm:px-6 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#D4AF37]" />
            {isSentFolder ? "Emails envoyés" : "Boîtes mail"}
            {unreadCount > 0 && <span className="ml-1 bg-[#D4AF37] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setReplyTo(null); setForwardTo(null); setComposeOpen(true); }}
              disabled={activeMailboxCfg?.isAlias}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all min-h-[36px] border ${
                activeMailboxCfg?.isAlias ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25 border-[#D4AF37]/40'
              }`}
              title={activeMailboxCfg?.isAlias ? 'Alias — envoi non disponible' : 'Écrire'}
            >
              <Send className="w-3.5 h-3.5" /><span className="hidden sm:inline">Écrire</span>
            </button>
            <button onClick={fetchList} disabled={loading} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 min-h-[36px]">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Actualiser</span>
            </button>
          </div>
        </div>

        {/* Sélecteur boîtes */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {MAILBOXES.map((mb) => {
            const Icon = mb.icon;
            const isActive = activeMailbox === mb.id;
            return (
              <button
                key={mb.id}
                onClick={() => setActiveMailbox(mb.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap min-h-[44px] border ${
                  isActive ? 'bg-[#D4AF37]/8 text-gray-900 border-gray-300' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 border-transparent'
                }`}
                style={isActive ? { borderColor: mb.color + '60', boxShadow: `0 0 0 1px ${mb.color}25` } : {}}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isActive ? mb.color : undefined }} />
                <span style={isActive ? { color: mb.color } : {}}>{mb.label}</span>
                {mb.isAlias && <span className="text-[9px] bg-yellow-500/20 text-yellow-400/80 px-1 py-0.5 rounded font-medium border border-yellow-500/20">alias</span>}
              </button>
            );
          })}
        </div>
      </div>

      {actionMsg && (
        <div className={`mx-3 sm:mx-6 mt-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
          actionMsg.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-600' : 'bg-red-50 border border-red-200 text-red-600'
        }`}>
          {actionMsg.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {actionMsg.text}
        </div>
      )}

      {activeMailboxCfg?.isAlias && (
        <div className="mx-3 sm:mx-6 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">📬</span>
            <div>
              <p className="text-sm font-semibold text-amber-600">Alias de redirection</p>
              <p className="text-xs text-amber-600/70 mt-1">
                {activeMailboxCfg.email} est une adresse de redirection, pas une boîte IMAP.<br />
                Sélectionnez « JS Store » ou « Assurances Dour » pour consulter et envoyer des emails.
              </p>
            </div>
          </div>
        </div>
      )}

      {!activeMailboxCfg?.isAlias && (
        <div className="flex flex-1 overflow-hidden">
          {/* Liste */}
          <div className={`flex flex-col ${detail ? 'hidden sm:flex sm:w-80 lg:w-96' : 'w-full'} border-r border-gray-200 overflow-hidden`}>
            <div className="px-3 py-2 border-b border-gray-200 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="w-full bg-gray-100 border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 placeholder-gray-600 focus:border-[#D4AF37]/40 focus:outline-none" />
              </div>
            </div>
            {loading ? (
              <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-2 py-10"><MailOpen className="w-8 h-8 text-gray-300" />Aucun email</div>
            ) : (
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {filtered.map(email => (
                  <EmailListItem key={email.uid} email={email} isSelected={selectedUid === email.uid} onClick={() => { setSelectedUid(email.uid); fetchDetail(email.uid); }} onDelete={handleDelete} onArchive={handleArchive} />
                ))}
              </div>
            )}
          </div>

          {/* Détail */}
          <div className={`flex-1 overflow-hidden ${detail ? 'flex' : 'hidden sm:flex'} flex-col`}>
            {loadingDetail ? (
              <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" /></div>
            ) : detail ? (
              <EmailDetail
                email={detail}
                mailboxId={activeMailbox}
                onBack={() => { setDetail(null); setSelectedUid(null); }}
                onReply={() => { setReplyTo(detail); setForwardTo(null); setComposeOpen(true); }}
                onForward={() => { setForwardTo(detail); setReplyTo(null); setComposeOpen(true); }}
                onPrint={() => {}}
                onDelete={async (uid) => { await handleDelete(uid); setDetail(null); setSelectedUid(null); }}
                onArchive={async (uid) => { await handleArchive(uid); setDetail(null); setSelectedUid(null); }}
              />
            ) : (
              <div className="flex-1 hidden sm:flex flex-col items-center justify-center text-gray-300 gap-2"><Mail className="w-10 h-10" /><p className="text-sm">Sélectionnez un email</p></div>
            )}
          </div>
        </div>
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setForwardTo(null); }}
        fromEmail={activeMailboxCfg?.email}
        replyTo={replyTo}
        forwardTo={forwardTo}
        onSend={handleSend}
      />
    </div>
  );
}
