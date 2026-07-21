import React, { useState, useEffect, useCallback } from "react";
import { Mail, RefreshCw, Paperclip, Search, ArrowLeft, Inbox, User, Calendar } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const API_BASE = import.meta.env.VITE_COCKPIT_API_URL || '';
const API_KEY = import.meta.env.VITE_AGENT_API_KEY || '';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff/60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff/3600)} h`;
  if (diff < 604800) return `il y a ${Math.floor(diff/86400)} j`;
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

function EmailListItem({ email, isSelected, onClick }) {
  const sender = extractSender(email.from);
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 cursor-pointer border-b border-white/5 transition-all duration-150 ${
        isSelected ? 'bg-[#D4AF37]/10 border-l-2 border-l-[#D4AF37]' : 'hover:bg-white/5'
      } ${!email.seen ? 'bg-white/3' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm truncate flex-1 mr-2 ${!email.seen ? 'font-semibold text-white' : 'text-gray-300'}`}>
          {sender.name}
        </span>
        <span className="text-[10px] text-gray-500 whitespace-nowrap">{timeAgo(email.date)}</span>
      </div>
      <div className="flex items-start gap-1">
        {!email.seen && <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] mt-1.5 flex-shrink-0" />}
        <p className={`text-xs truncate ${!email.seen ? 'text-gray-200' : 'text-gray-400'}`}>
          {email.subject}
        </p>
      </div>
      {email.body && (
        <p className="text-[11px] text-gray-600 truncate mt-0.5">{email.body}</p>
      )}
      {email.hasAttachment && (
        <Paperclip className="w-3 h-3 text-gray-500 mt-1" />
      )}
    </div>
  );
}

function EmailDetail({ email, onBack }) {
  const sender = extractSender(email.from);
  
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors md:hidden">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-white truncate">{email.subject}</h2>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <User className="w-3 h-3" /> {sender.name}
              {sender.email && sender.email !== sender.name && (
                <span className="text-gray-600">({sender.email})</span>
              )}
            </span>
            {email.date && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Calendar className="w-3 h-3" /> {formatDate(email.date)}
              </span>
            )}
          </div>
          {email.to && (
            <p className="text-[11px] text-gray-600 mt-0.5">À : {email.to}</p>
          )}
        </div>
      </div>

      {/* Corps */}
      <div className="flex-1 overflow-y-auto p-6">
        {email.html ? (
          <div
            className="email-html-content text-sm text-gray-300 leading-relaxed"
            style={{ maxWidth: '100%', overflowX: 'hidden' }}
            dangerouslySetInnerHTML={{ __html: email.html }}
          />
        ) : (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {email.text || '(email vide)'}
          </pre>
        )}

        {/* Pièces jointes */}
        {email.attachments?.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
              Pièces jointes ({email.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {email.attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 text-xs text-gray-300">
                  <Paperclip className="w-3 h-3 text-[#D4AF37]" />
                  <span>{a.filename || 'fichier'}</span>
                  {a.size && <span className="text-gray-500">({Math.round(a.size/1024)} Ko)</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Emails() {
  const { user } = useAuth();
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/emails?limit=50`, {
        headers: { 'x-api-key': API_KEY }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEmails(data.emails || []);
      setTotal(data.total || 0);
      setUnread(data.unread || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const openEmail = useCallback(async (email) => {
    setSelectedEmail(email);
    setLoadingDetail(true);
    setSelectedDetail(null);
    try {
      const res = await fetch(`${API_BASE}/api/emails/${email.uid}`, {
        headers: { 'x-api-key': API_KEY }
      });
      const data = await res.json();
      if (data.success) {
        setSelectedDetail(data.email);
        // Marquer comme lu localement
        setEmails(prev => prev.map(e => e.uid === email.uid ? { ...e, seen: true } : e));
        setUnread(prev => Math.max(0, prev - (email.seen ? 0 : 1)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = emails.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.subject?.toLowerCase().includes(q) ||
           e.from?.toLowerCase().includes(q) ||
           e.body?.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full bg-[#0B0B0F] text-white overflow-hidden" style={{ minHeight: 'calc(100vh - 64px)' }}>

      {/* ─── Liste emails ─────────────────────────────────────── */}
      <div className={`flex flex-col border-r border-white/10 bg-[#13131A] ${selectedEmail ? 'hidden md:flex md:w-80 lg:w-96 flex-shrink-0' : 'w-full md:w-80 lg:w-96 flex-shrink-0'}`}>
        
        {/* Header liste */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-sm font-semibold text-white">info@jsinnovia.com</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#D4AF37] text-black text-[10px] font-bold">
                  {unread}
                </span>
              )}
            </div>
            <button
              onClick={fetchList}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Barre de recherche */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {!loading && (
            <p className="text-[10px] text-gray-600 mt-2">
              {total} email{total > 1 ? 's' : ''} · {unread} non lu{unread > 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-4 m-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <p className="font-medium mb-1">Connexion IMAP impossible</p>
              <p className="text-red-500">{error}</p>
              <button onClick={fetchList} className="mt-2 text-red-300 hover:text-red-100 underline">
                Réessayer
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col gap-0">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-white/5 animate-pulse">
                  <div className="flex justify-between mb-2">
                    <div className="h-3 bg-white/10 rounded w-32" />
                    <div className="h-3 bg-white/5 rounded w-12" />
                  </div>
                  <div className="h-2.5 bg-white/5 rounded w-full" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-600">
              <Mail className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">{search ? 'Aucun résultat' : 'Aucun email'}</p>
            </div>
          ) : (
            filtered.map(email => (
              <EmailListItem
                key={email.uid}
                email={email}
                isSelected={selectedEmail?.uid === email.uid}
                onClick={() => openEmail(email)}
              />
            ))
          )}
        </div>
      </div>

      {/* ─── Détail email ─────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col bg-[#0F0F1A] overflow-hidden ${!selectedEmail ? 'hidden md:flex' : 'flex'}`}>
        {!selectedEmail ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-700">
            <Mail className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-sm">Sélectionne un email</p>
          </div>
        ) : loadingDetail ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : selectedDetail ? (
          <EmailDetail
            email={selectedDetail}
            onBack={() => { setSelectedEmail(null); setSelectedDetail(null); }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Impossible de charger cet email.
          </div>
        )}
      </div>

      {/* Style global pour le HTML des emails */}
      <style>{`
        .email-html-content img { max-width: 100%; height: auto; }
        .email-html-content a { color: #D4AF37; }
        .email-html-content table { width: 100%; border-collapse: collapse; }
        .email-html-content td, .email-html-content th { padding: 4px 8px; }
        .email-html-content p { margin-bottom: 8px; }
      `}</style>
    </div>
  );
}
