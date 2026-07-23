import React, { useState, useEffect, useCallback } from "react";
import { Mail, RefreshCw, Paperclip, Search, ArrowLeft, Inbox, User, Calendar, Shield } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_URL, AGENT_KEY } from '@/config/agent';

const API_BASE = AGENT_URL;
const API_KEY = AGENT_KEY;

const MAILBOXES = [
  { id: 'jsinnovia',   label: 'JS-Innov.IA',   email: 'info@jsinnovia.com',           icon: Mail,       color: '#D4AF37' },
  { id: 'assurances',  label: 'Assurances Dour', email: 'julien.pagin@assurancesdour.be', icon: Shield,     color: '#06B6D4' },
];

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

      <div className="flex-1 overflow-y-auto p-6">
        {email.html ? (
          <div
            className="prose prose-invert max-w-none text-sm text-gray-200"
            dangerouslySetInnerHTML={{ __html: email.html }}
          />
        ) : (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans">{email.text}</pre>
        )}

        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1">
              <Paperclip className="w-3 h-3" /> Pièces jointes ({email.attachments.length})
            </p>
            {email.attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-400 py-1">
                <Paperclip className="w-3 h-3" />
                <span>{a.filename}</span>
                <span className="text-gray-600">({Math.round((a.size || 0) / 1024)} KB)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Emails() {
  const { user } = useAuth();
  const [activeMailbox, setActiveMailbox] = useState('jsinnovia');
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUid, setSelectedUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/emails?mailbox=${activeMailbox}&limit=50`, {
        headers: { 'x-api-key': API_KEY },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');
      setEmails(data.emails || []);
    } catch (err) {
      setError(err.message);
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [activeMailbox]);

  const fetchDetail = useCallback(async (uid) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/api/emails/${uid}?mailbox=${activeMailbox}`, {
        headers: { 'x-api-key': API_KEY },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');
      setDetail(data.email);
      // Marquer comme lu localement
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, seen: true } : e));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDetail(false);
    }
  }, [activeMailbox]);

  useEffect(() => {
    fetchList();
    setSelectedUid(null);
    setDetail(null);
  }, [fetchList]);

  const selectedEmail = emails.find(e => e.uid === selectedUid);
  const filtered = search
    ? emails.filter(e =>
        e.subject?.toLowerCase().includes(search.toLowerCase()) ||
        e.from?.toLowerCase().includes(search.toLowerCase())
      )
    : emails;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header avec sélecteur de mailbox */}
      <div className="px-6 py-4 border-b border-white/10 bg-[#0B0B0F]/50">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#D4AF37]" />
            Boîtes mail
          </h1>
          <button
            onClick={fetchList}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {/* Sélecteur de mailbox */}
        <div className="flex gap-2">
          {MAILBOXES.map((mb) => {
            const Icon = mb.icon;
            const isActive = activeMailbox === mb.id;
            return (
              <button
                key={mb.id}
                onClick={() => setActiveMailbox(mb.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-white/10 text-white border'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                style={isActive ? { borderColor: mb.color + '40' } : {}}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: mb.color }} />
                {mb.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenu */}
      {error && (
        <div className="px-6 py-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            <p className="font-semibold mb-1">Erreur de connexion</p>
            <p className="text-xs">{error}</p>
            <p className="text-xs text-gray-500 mt-2">
              Vérifiez que la variable EMAIL_PASSWORD{activeMailbox === 'assurances' ? '_ASSURANCES' : ''} est configurée sur Railway.
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Liste */}
        <div className="w-full md:w-96 border-r border-white/10 flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              Chargement...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm">
              <Inbox className="w-8 h-8 mb-2 opacity-30" />
              Aucun email
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-white/5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-full bg-white/5 text-xs text-white placeholder-gray-600 rounded-lg pl-8 pr-3 py-1.5 border border-white/5 focus:border-[#D4AF37]/30 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filtered.map(email => (
                  <EmailListItem
                    key={email.uid}
                    email={email}
                    isSelected={selectedUid === email.uid}
                    onClick={() => {
                      setSelectedUid(email.uid);
                      fetchDetail(email.uid);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Détail */}
        <div className="hidden md:flex flex-1 flex-col">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              Chargement de l'email...
            </div>
          ) : detail ? (
            <EmailDetail email={detail} onBack={() => setSelectedUid(null)} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
              <Mail className="w-12 h-12 mb-3 opacity-20" />
              Sélectionnez un email pour le lire
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
