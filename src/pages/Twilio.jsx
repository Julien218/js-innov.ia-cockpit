import React, { useState, useEffect, useCallback } from "react";
import {
  MessageSquare, Phone, Send, RefreshCw, Loader2, AlertCircle, Check,
  DollarSign, Clock, ArrowUpRight, ArrowDownLeft, Smartphone,
  TrendingUp, Hash
} from "lucide-react";

const API_BASE = '';

// ── Helpers ──
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
  return new Date(dateStr).toLocaleString('fr-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatPrice(price, unit) {
  if (!price) return '—';
  const val = parseFloat(price);
  const sign = val < 0 ? '-' : '';
  return `${sign}${Math.abs(val).toFixed(4)} ${unit || ''}`;
}

function statusColor(status) {
  if (!status) return 'text-gray-400';
  const s = status.toLowerCase();
  if (['delivered', 'sent', 'completed', 'queued'].includes(s)) return 'text-emerald-500';
  if (['failed', 'undelivered', 'canceled', 'no-answer', 'busy'].includes(s)) return 'text-red-500';
  if (['sending', 'ringing', 'in-progress'].includes(s)) return 'text-blue-500';
  return 'text-gray-400';
}

// ── SMS Composer ──
function SmsComposer({ numbers, onSend }) {
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (numbers.length > 0 && !from) setFrom(numbers[0].phoneNumber);
  }, [numbers, from]);

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) { setError('Destinataire et message requis.'); return; }
    setSending(true); setError(null); setStatus(null);
    try {
      await onSend({ to, from, body });
      setStatus('success');
      setBody('');
      setTimeout(() => setStatus(null), 3000);
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  const charCount = body.length;
  const segments = Math.ceil(charCount / 160);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Send className="w-4 h-4 text-[#D4AF37]" /> Nouveau SMS
        </h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">De (numéro Twilio)</label>
            <select value={from} onChange={e => setFrom(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-[#D4AF37]/50 focus:outline-none">
              {numbers.length === 0 && <option value="">Aucun numéro</option>}
              {numbers.map(n => <option key={n.sid} value={n.phoneNumber}>{n.phoneNumber}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Destinataire</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="+32xxxxxxxx" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#D4AF37]/50 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Message</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#D4AF37]/50 focus:outline-none resize-none" placeholder="Votre message SMS..." />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">{charCount} caractères · {segments} segment(s)</span>
            <span className="text-[10px] text-gray-400">1 segment = 160 caractères</span>
          </div>
        </div>
        {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>}
        {status === 'success' && <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-600"><Check className="w-3.5 h-3.5" /> SMS envoyé !</div>}
        <div className="flex justify-end">
          <button onClick={handleSend} disabled={sending || numbers.length === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#D4AF37] text-black hover:bg-[#C49B2F] disabled:opacity-50 transition-all">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? 'Envoi...' : 'Envoyer SMS'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message History ──
function MessageHistory({ messages, loading }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#D4AF37]" /> Historique SMS
        </h3>
        {messages.length > 0 && <span className="text-xs text-gray-400">{messages.length} message(s)</span>}
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <MessageSquare className="w-8 h-8 text-gray-300" /> Aucun message
          </div>
        ) : (
          messages.map(m => {
            const isInbound = m.direction === 'inbound';
            return (
              <div key={m.sid} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isInbound ? 'bg-blue-50' : 'bg-amber-50'
                  }`}>
                    {isInbound ? <ArrowDownLeft className="w-4 h-4 text-blue-500" /> : <ArrowUpRight className="w-4 h-4 text-[#D4AF37]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">
                        {isInbound ? `De: ${m.from}` : `À: ${m.to}`}
                      </span>
                      <span className="text-[10px] text-gray-400">{formatDate(m.dateCreated)}</span>
                    </div>
                    <p className="text-sm text-gray-800 truncate">{m.body}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-[10px] font-medium ${statusColor(m.status)}`}>{m.status}</span>
                      {m.segments > 1 && <span className="text-[10px] text-gray-400">{m.segments} seg</span>}
                      {m.price && <span className="text-[10px] text-gray-400">{formatPrice(m.price, m.priceUnit)}</span>}
                      {m.errorMessage && <span className="text-[10px] text-red-500 truncate">{m.errorMessage}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Call History ──
function CallHistory({ calls, loading }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Phone className="w-4 h-4 text-[#D4AF37]" /> Historique appels
        </h3>
        {calls.length > 0 && <span className="text-xs text-gray-400">{calls.length} appel(s)</span>}
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]" /></div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <Phone className="w-8 h-8 text-gray-300" /> Aucun appel
          </div>
        ) : (
          calls.map(c => (
            <div key={c.sid} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${c.direction === 'inbound' ? 'bg-blue-50' : 'bg-amber-50'}`}>
                  <Phone className={`w-4 h-4 ${c.direction === 'inbound' ? 'text-blue-500' : 'text-[#D4AF37]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700">{c.direction === 'inbound' ? `De: ${c.fromFormatted || c.from}` : `À: ${c.toFormatted || c.to}`}</span>
                    <span className="text-[10px] text-gray-400">{formatDate(c.startTime)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-[10px] font-medium ${statusColor(c.status)}`}>{c.status}</span>
                    {c.duration && c.duration !== '0' && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Clock className="w-3 h-3" /> {c.duration}s</span>}
                    {c.price && <span className="text-[10px] text-gray-400">{formatPrice(c.price, c.priceUnit)}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Page ──
export default function Twilio() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [account, setAccount] = useState(null);
  const [numbers, setNumbers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tabs = [
    { id: 'dashboard', label: 'Tableau de bord', icon: TrendingUp },
    { id: 'sms', label: 'Envoyer SMS', icon: Send },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'calls', label: 'Appels', icon: Phone },
  ];

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [accRes, numRes, msgRes, callRes] = await Promise.all([
        fetch(`${API_BASE}/api/twilio/account`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/twilio/numbers`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/twilio/messages?limit=50`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/twilio/calls?limit=30`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
      ]);

      if (accRes) setAccount(accRes);
      if (numRes?.success) setNumbers(numRes.numbers || []);
      if (msgRes?.success) setMessages(msgRes.messages || []);
      if (callRes?.success) setCalls(callRes.calls || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSendSms = async ({ to, from, body }) => {
    const res = await fetch(`${API_BASE}/api/twilio/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ to, from, body }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Erreur d'envoi");
    fetchAll();
  };

  // ── Not configured ──
  if (account && !account.configured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-amber-500" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900">Twilio non configuré</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md">
            Ajoutez TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN dans les variables d'environnement Railway pour activer le module.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 bg-gray-50 min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-[#D4AF37]" /> Twilio
        </h1>
        <button onClick={fetchAll} disabled={loading} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {/* Stats cards */}
      {account?.success && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><DollarSign className="w-3.5 h-3.5" /> Balance</div>
            <p className="text-xl font-bold text-gray-900">{account.balance.value.toFixed(2)} <span className="text-sm text-gray-400">{account.balance.currency}</span></p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Hash className="w-3.5 h-3.5" /> Numéros</div>
            <p className="text-xl font-bold text-gray-900">{numbers.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><MessageSquare className="w-3.5 h-3.5" /> SMS</div>
            <p className="text-xl font-bold text-gray-900">{messages.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Phone className="w-3.5 h-3.5" /> Appels</div>
            <p className="text-xl font-bold text-gray-900">{calls.length}</p>
          </div>
        </div>
      )}

      {/* Account info */}
      {account?.success && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{account.account.friendlyName}</p>
              <p className="text-xs text-gray-500">{account.account.sid} · Type: {account.account.type} · Statut: <span className={statusColor(account.account.status)}>{account.account.status}</span></p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap border ${
                isActive ? 'bg-white text-gray-900 border-gray-300 shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-white border-transparent'
              }`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {loading && !account ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" /></div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> {error}</div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <div className="space-y-4">
              {/* Phone numbers list */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Smartphone className="w-4 h-4 text-[#D4AF37]" /> Numéros téléphoniques</h3>
                </div>
                <div className="divide-y divide-gray-50">
                  {numbers.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-gray-400 text-center">Aucun numéro configuré</p>
                  ) : numbers.map(n => (
                    <div key={n.sid} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{n.friendlyName || n.phoneNumber}</p>
                        <p className="text-xs text-gray-500">{n.phoneNumber}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {n.capabilities?.sms && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-200">SMS</span>}
                        {n.capabilities?.voice && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-200">Voix</span>}
                        {n.capabilities?.mms && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full border border-purple-200">MMS</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Recent messages preview */}
              <MessageHistory messages={messages.slice(0, 10)} loading={false} />
            </div>
          )}
          {activeTab === 'sms' && <SmsComposer numbers={numbers} onSend={handleSendSms} />}
          {activeTab === 'messages' && <MessageHistory messages={messages} loading={false} />}
          {activeTab === 'calls' && <CallHistory calls={calls} loading={false} />}
        </>
      )}
    </div>
  );
}
