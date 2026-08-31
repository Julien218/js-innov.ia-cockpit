/**
 * FloatingAgent.jsx — Widget flottant NOVA pour le cockpit
 * 
 * Bulle de chat persistante en bas à droite, accessible sur toutes les pages.
 * Communique avec l'assistant local /api/assistant/chat (Railway, zéro Base44).
 * 
 * Fonctionnalités:
 * - Avatar NOVA (phoenix gold/cyan)
 * - Reconnaissance vocale (Web Speech API) — parler à NOVA
 * - Synthèse vocale (speechSynthesis) — NOVA lit à voix haute
 * - Persistance localStorage (50 derniers messages)
 * - Actions CRM avec confirmation
 * 
 * Design: dark theme cockpit — noir profond + or premium + cyan
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import novaAvatar from '@/assets/nova-avatar-128.png';
import { chooseNovaVoice } from '@/lib/nova-voice';
import { inspectMediaFile } from '@/lib/mediaReference';
import { executeNovaClientAction } from '@/lib/novaClientAction';
import { isDropboxDeletionRequest, sendNovaChat } from '@/lib/novaChatTransport';

const LOCAL_NOVA_URLS = ['http://127.0.0.1:8788', 'http://127.0.0.1:8787'];
const LOCAL_TASK_SNAPSHOT_KEY = 'nova_local_task_snapshot_v1';
const LOCAL_AUTOPILOT_LAST_RUN_KEY = 'nova_local_autopilot_last_run_v1';
const RECENT_MEDIA_KEY = 'nova_recent_media_v1';
const TTS_VOICE_KEY = 'nova_tts_voice_name';
const LOCAL_TOOL_REQUEST = /\b(?:find_local_workflows|comfyui_health|avatar_factory_status|ffmpeg_version|ffprobe_file|list_directory|http_diagnose)\b|(?:ex[eé]cut|diagnosti|contr[oô]l|v[eé]rifi|recherch).*(?:comfyui|port\s*(?:8188|8791)|workflow|minimax|avatar|ffmpeg|ffprobe|dossier\s+local)/i;
const LOCAL_NOVA_PROMPT = `Tu es NOVA, l’unique assistant visible du Cockpit JS-Innov.IA. Tu conserves le même nom et le même rôle en mode cloud et en mode local. Vérifie les outils réellement disponibles avant toute affirmation de capacité. Ne dis jamais que tu es une simple IA textuelle ni que tu ne peux rien exécuter uniquement parce qu’Internet est coupé.`;
const AFFIRMATIVE_CONFIRMATION = /^(oui|ok|oki|okay|confirme|je confirme|vas[- ]?y|go|ex[eé]cute)(?:\b|[,.!])/i;
const NEGATIVE_CONFIRMATION = /^(non|annule|annuler|stop)(?:\b|[,.!])/i;

const FloatingAgent = () => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('agent_chat_messages');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => localStorage.getItem('agent_conversation_id') || 'floating');
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('agent_tts_enabled') === 'true');
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsVoiceName, setTtsVoiceName] = useState(() => localStorage.getItem(TTS_VOICE_KEY) || '');
  const [speaking, setSpeaking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const fileInputRef = useRef(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const sttSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Persist messages
  useEffect(() => {
    try { localStorage.setItem('agent_chat_messages', JSON.stringify(messages.slice(-50))); } catch {}
  }, [messages]);

  // Persist TTS preference
  useEffect(() => {
    localStorage.setItem('agent_tts_enabled', String(ttsEnabled));
  }, [ttsEnabled]);

  useEffect(() => {
    if (ttsVoiceName) localStorage.setItem(TTS_VOICE_KEY, ttsVoiceName);
  }, [ttsVoiceName]);

  // Conserve une copie minimale des tâches pour que NOVA puisse les consulter hors connexion.
  useEffect(() => {
    let stopped = false;
    let syncing = false;
    const syncLocalTasks = async () => {
      if (stopped || syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      syncing = true;
      try {
        const response = await fetch('/api/data/Tache?limit=100', { credentials: 'include', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.items) ? payload.items : [];
        const tasks = rows.slice(0, 100).map((task) => ({
          id: task.id,
          titre: task.titre || task.title || task.nom,
          description: task.description || '',
          notes: task.notes || '',
          statut: task.statut || task.status,
          priorite: task.priorite || task.priority,
          date_echeance: task.date_echeance || task.due_date,
        }));
        localStorage.setItem(LOCAL_TASK_SNAPSHOT_KEY, JSON.stringify({ synced_at: new Date().toISOString(), tasks }));
        const now = Date.now();
        const lastRun = Number(localStorage.getItem(LOCAL_AUTOPILOT_LAST_RUN_KEY) || 0);
        if (now - lastRun >= 60_000) {
          const taskSnapshot = { synced_at: new Date().toISOString(), tasks };
          for (const localUrl of LOCAL_NOVA_URLS) {
            try {
              const localResponse = await fetch(`${localUrl}/api/tasks/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_snapshot: taskSnapshot }), signal: AbortSignal.timeout(120000) });
              const localResult = await localResponse.json().catch(() => ({}));
              if (!localResponse.ok) throw new Error(localResult.error || `HTTP ${localResponse.status}`);
              if (Array.isArray(localResult.task_results) && localResult.task_results.length) {
                const syncResponse = await fetch('/api/task-autopilot/local-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ task_results: localResult.task_results }) });
                if (!syncResponse.ok) throw new Error(`Synchronisation locale HTTP ${syncResponse.status}`);
              }
              localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now()));
              break;
            } catch {}
          }
        }
      } catch {
        // La copie précédente reste disponible hors connexion.
      } finally {
        syncing = false;
      }
    };
    void syncLocalTasks();
    const timer = setInterval(() => void syncLocalTasks(), 60_000);
    const online = () => void syncLocalTasks();
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, []);

  // Preload TTS voices
  useEffect(() => {
    if (ttsSupported) {
      const refreshVoices = () => {
        const french = window.speechSynthesis.getVoices().filter((voice) => String(voice.lang || '').toLowerCase().startsWith('fr'));
        setTtsVoices(french);
        if (!ttsVoiceName && french.length) {
          const selected = chooseNovaVoice(french);
          if (selected) setTtsVoiceName(selected.name);
        }
      };
      refreshVoices();
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    return () => {
      if (ttsSupported) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [ttsSupported, ttsVoiceName]);

  // === Text-to-Speech ===
  const speak = useCallback((text) => {
    if (!ttsSupported || !ttsEnabled || !text) return;
    const cleanText = text
      .replace(/\[Contexte Dropbox[^\]]*\]/gi, '')
      .replace(/[#*_~`]/g, '')
      .replace(/⚠️/g, '')
      .replace(/https?:\/\/\S+/gi, 'lien internet')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, 'identifiant du journal')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .slice(0, 500);

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = chooseNovaVoice(voices, ttsVoiceName);
    utter.lang = selectedVoice?.lang || 'fr-BE';
    utter.rate = 0.96;
    utter.pitch = 1.0;
    if (selectedVoice) utter.voice = selectedVoice;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, [ttsSupported, ttsEnabled, ttsVoiceName]);

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) { window.speechSynthesis.cancel(); setSpeaking(false); }
  }, [ttsSupported]);

  // === Speech Recognition ===
  const startListening = useCallback(() => {
    if (!sttSupported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'fr-BE';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let finalTranscript = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      setInput(finalTranscript + interim);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript.trim()) {
        setInput(finalTranscript.trim());
        setTimeout(() => doSend(finalTranscript.trim()), 100);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }, [sttSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); setIsListening(false); }
  }, []);

  const executeConfirmation = useCallback(async (userMessage = '') => {
    if (!confirmation || loading) return;
    if (userMessage) setMessages(prev => [...prev, { role: 'user', content: userMessage, ts: Date.now() }]);
    setLoading(true);
    stopSpeaking();
    try {
      const response = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: confirmation.token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Action non exécutée par le Cockpit');

      if (data.client_action) {
        const actionResult = await executeNovaClientAction(data.client_action);
        if (data.completion_token) {
          await fetch('/api/assistant/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              token: data.completion_token,
              success: actionResult.ok,
              details: actionResult.details,
            }),
          }).catch(() => null);
        }
        if (!actionResult.ok) throw new Error(actionResult.data?.error || 'Action métier non exécutée');
      }

      const target = data.execution?.target ? ` · cible=${data.execution.target}` : '';
      const success = `✅ Action ${data.action_type || confirmation.type || 'Cockpit'} réellement exécutée et journalisée${target}.`;
      setMessages(prev => [...prev, { role: 'assistant', content: success, ts: Date.now() }]);
      speak(success);
    } catch (error) {
      const failure = `❌ ${error.message}`;
      setMessages(prev => [...prev, { role: 'assistant', content: failure, ts: Date.now(), isError: true }]);
    } finally {
      setConfirmation(null);
      setLoading(false);
    }
  }, [confirmation, loading, speak, stopSpeaking]);

  // === Chat ===
  const doSend = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    if (confirmation && AFFIRMATIVE_CONFIRMATION.test(msg)) {
      setInput('');
      await executeConfirmation(msg);
      return;
    }
    if (confirmation && NEGATIVE_CONFIRMATION.test(msg)) {
      setInput('');
      setMessages(prev => [...prev,
        { role: 'user', content: msg, ts: Date.now() },
        { role: 'assistant', content: 'Action annulée. Aucune modification n’a été exécutée.', ts: Date.now() },
      ]);
      setConfirmation(null);
      return;
    }
    const requiresLocalTool = LOCAL_TOOL_REQUEST.test(msg);
    if (isDropboxDeletionRequest(msg)) setConfirmation(null);

    setInput('');
    stopSpeaking();
    setMessages(prev => [...prev, { role: 'user', content: msg, ts: Date.now() }]);
    setLoading(true);

    try {
      const sendCloud = async () => {
        let recentMedia = null;
        try { recentMedia = JSON.parse(localStorage.getItem(RECENT_MEDIA_KEY) || 'null'); } catch {}
        const resp = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: msg, conversation_id: conversationId, recent_media: recentMedia }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          const error = new Error(errData.error || 'Le Cockpit a refusé la demande');
          error.cockpitResponse = true;
          throw error;
        }
        return resp.json();
      };

      const sendLocal = async () => {
        let lastError;
        let taskSnapshot = null;
        let recentMedia = null;
        try { taskSnapshot = JSON.parse(localStorage.getItem(LOCAL_TASK_SNAPSHOT_KEY) || 'null'); } catch {}
        try { recentMedia = JSON.parse(localStorage.getItem(RECENT_MEDIA_KEY) || 'null'); } catch {}
        for (const localUrl of LOCAL_NOVA_URLS) {
          try {
            const resp = await fetch(`${localUrl}/api/agent/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: msg,
                history: messages.slice(-20).map(({ role, content }) => ({ role, content })),
                system_prompt: LOCAL_NOVA_PROMPT,
                context: { source: 'cockpit-nova', conversation_id: conversationId, offline: true, task_snapshot: taskSnapshot, recent_media: recentMedia },
              }),
              signal: AbortSignal.timeout(90000),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `NOVA locale indisponible (${resp.status})`);
            return { ...data, local_fallback: true, local_endpoint: localUrl };
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('NOVA locale indisponible');
      };

      const data = await sendNovaChat({ message: msg, requiresLocalTool,
        offline: typeof navigator !== 'undefined' && navigator.onLine === false, sendCloud, sendLocal });

      if (data.action_type === 'delete_dropbox_file') {
        queryClient.invalidateQueries({ queryKey: ['portfolio-dropbox-assets'] });
        window.dispatchEvent(new Event('cockpit-documents-changed'));
        queryClient.invalidateQueries({ queryKey: ['Tache'] });
        setConfirmation(null);
      }
      let content = data.message || data.response || data.reply || data.content || data.text || 'Réponse vide';
      if (data.local_fallback) content = `Mode local · ${content}`;
      if (data.confirmation) {
        content += '\n\n⚠️ Action proposée: ' + (data.confirmation.type || 'Action') + '. Confirme pour exécuter.';
        setConfirmation(data.confirmation);
      }

      setMessages(prev => [...prev, { role: 'assistant', content, ts: Date.now() }]);
      speak(content);
    } catch (err) {
      const prefix = err?.dropboxVerification ? '⚠️ Suppression Dropbox non vérifiée : ' : err?.cockpitResponse
        ? '⚠️ Le Cockpit a répondu : '
        : requiresLocalTool ? '⚠️ L’agent local requis est injoignable : ' : '⚠️ NOVA cloud et locale sont injoignables : ';
      setMessages(prev => [...prev, { role: 'assistant', content: prefix + err.message, ts: Date.now(), isError: true }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, confirmation, executeConfirmation, conversationId, messages, speak, stopSpeaking, queryClient]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }, [doSend]);

  const resetConversation = useCallback(async () => {
    stopSpeaking();
    setMessages([]);
    setConfirmation(null);
    localStorage.removeItem('agent_chat_messages');
    localStorage.removeItem(RECENT_MEDIA_KEY);
    try {
      await fetch('/api/assistant/history?conversation_id=floating', { method: 'DELETE', credentials: 'include' });
    } catch {}
  }, [stopSpeaking]);

  // === File Upload → Classify → Dropbox ===
  const handleFileUpload = useCallback(async (incomingFiles) => {
    const files = Array.from(incomingFiles || []);
    if (!files.length || uploading) return;
    const oversized = files.find((file) => file.size > 100 * 1024 * 1024);
    if (oversized) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${oversized.name} dépasse la limite de 100 Mo.`, ts: Date.now(), isError: true }]);
      return;
    }

    setUploading(true);
    const context = input.trim();
    for (const file of files) {
      const uploadId = `upload-${Date.now()}-${file.name}`;
      const sizeLabel = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} Mo` : `${(file.size / 1024).toFixed(0)} Ko`;
      setMessages(prev => [...prev,
        { role: 'user', content: `📎 ${file.name} (${sizeLabel})${context ? `\n${context}` : ''}`, ts: Date.now(), isFile: true },
        { role: 'assistant', content: '🔄 NOVA classe et archive le média dans Dropbox…', ts: Date.now(), isSystem: true, uploadId },
      ]);
      try {
        const mediaMetadata = await inspectMediaFile(file);
        const resp = await fetch(`/api/assistant/upload-media?conversation_id=${encodeURIComponent(conversationId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-nova-file-name': encodeURIComponent(file.name),
            'x-nova-file-type': encodeURIComponent(file.type || 'application/octet-stream'),
            'x-nova-file-context': encodeURIComponent(context.slice(0, 1000)),
            'x-nova-media-metadata': encodeURIComponent(JSON.stringify(mediaMetadata)),
          },
          credentials: 'include',
          body: file,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `Archivage impossible (HTTP ${resp.status})`);

        const cl = data.classification || {};
        const clientInfo = cl.matchedClient ? `\n👤 Client: ${cl.matchedClient.name}` : '\n👤 Client: non identifié — rangé dans A_Classer';
        const projectInfo = cl.matchedProject ? `\n📌 Projet: ${cl.matchedProject.name}` : '';
        const indexInfo = data.indexed ? `\n🗂️ Index Cockpit: ${data.documentId}` : `\n🗂️ Index Cockpit: non créé${data.indexWarning ? ` (${data.indexWarning})` : ''}`;
        const reference = data.reference || {};
        const referenceInfo = reference.dropboxPath
          ? `\n🏷️ Référencement: ${reference.title || 'contenu'}${reference.keywords?.length ? `\n🔎 Mots-clés: ${reference.keywords.join(', ')}` : ''}\n🧾 Fiche média: ${reference.dropboxPath}`
          : '';
        const renamedInfo = data.originalFileName && data.originalFileName !== data.fileName ? `\n↪️ Nom original: ${data.originalFileName}` : '';
        const memoryInfo = data.memorySynced ? '\n🧠 Média relié à cette conversation' : `\n🧠 Mémoire: non synchronisée${data.memoryWarning ? ` (${data.memoryWarning})` : ''}`;
        try {
          localStorage.setItem(RECENT_MEDIA_KEY, JSON.stringify({
            originalFileName: data.originalFileName,
            fileName: data.fileName,
            mediaType: cl.mediaType,
            title: reference.title,
            clientName: cl.matchedClient?.name || '',
            projectName: cl.matchedProject?.name || '',
            dropboxPath: data.dropboxPath,
            documentId: data.documentId,
            storedAt: data.storedAt,
          }));
        } catch {}
        setMessages(prev => prev.filter((message) => message.uploadId !== uploadId).concat({
          role: 'assistant',
          content: `✅ Média archivé et référencé dans Dropbox\n\n📄 ${data.fileName}${renamedInfo}\n🎞️ Type: ${cl.mediaType || 'Média'}${clientInfo}${projectInfo}\n📂 ${data.dropboxPath}${referenceInfo}${indexInfo}${memoryInfo}\n🧾 Journal: ${data.journalId}\n🕒 ${data.storedAt}`,
          ts: Date.now(),
        }));
        speak(`Média ${data.fileName} classé et sauvegardé dans Dropbox`);
      } catch (err) {
        setMessages(prev => prev.filter((message) => message.uploadId !== uploadId).concat({ role: 'assistant', content: '⚠️ ' + err.message, ts: Date.now(), isError: true }));
      }
    }
    setUploading(false);
    setInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploading, input, speak, conversationId]);

  const toggleVoice = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const toggleTts = useCallback(() => {
    if (ttsEnabled) { stopSpeaking(); setTtsEnabled(false); }
    else setTtsEnabled(true);
  }, [ttsEnabled, stopSpeaking]);

  const statusColor = speaking ? '#D4AF37' : isListening ? '#06B6D4' : loading ? '#f59e0b' : '#22c55e';
  const statusText = speaking ? 'Parle...' : isListening ? 'Écoute...' : loading ? 'Réfléchit...' : 'En ligne';

  return (
    <>
      {/* Bulle flottante */}
      {!isOpen && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999,
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          <div
            onClick={() => setIsOpen(true)}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            title="NOVA — Assistant IA"
            style={{
              width: '60px', height: '60px', borderRadius: '50%',
              cursor: 'pointer', overflow: 'hidden', position: 'relative',
              boxShadow: '0 4px 20px rgba(212,175,55,0.3), 0 0 0 2px rgba(212,175,55,0.5)',
              transition: 'transform 0.2s ease',
            }}
          >
            <img src={novaAvatar} alt="NOVA" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            <span style={{
              position: 'absolute', top: '-2px', right: '-2px',
              width: '12px', height: '12px', borderRadius: '50%',
              background: '#06B6D4', border: '2px solid #0B0B0F',
            }} />
          </div>
        </div>
      )}

      {/* Panel de chat */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px',
          width: '380px', height: '540px', maxHeight: 'calc(100vh - 40px)',
          background: '#0B0B0F', borderRadius: '16px',
          border: '1px solid rgba(212,175,55,0.4)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', zIndex: 99999, overflow: 'hidden',
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
            borderBottom: '1px solid rgba(212,175,55,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={novaAvatar} alt="NOVA" style={{
                width: '36px', height: '36px', borderRadius: '50%',
                objectFit: 'cover', border: '1px solid rgba(212,175,55,0.4)',
              }} />
              <div>
                <p style={{ color: '#D4AF37', fontSize: '14px', fontWeight: 600, margin: 0 }}>NOVA</p>
                <p style={{ color: '#64748b', fontSize: '11px', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', background: statusColor }} />
                  {statusText}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {ttsEnabled && ttsVoices.length > 0 && (
                <select
                  aria-label="Voix de NOVA"
                  title="Choisir la voix française de NOVA"
                  value={ttsVoiceName}
                  onChange={(event) => setTtsVoiceName(event.target.value)}
                  style={{
                    maxWidth: '104px', background: '#0F172A', border: '1px solid rgba(100,116,139,0.35)',
                    borderRadius: '6px', color: '#cbd5e1', fontSize: '10px', padding: '3px 5px',
                  }}
                >
                  {ttsVoices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name}</option>)}
                </select>
              )}
              <button
                onClick={toggleTts}
                title={ttsEnabled ? 'Lecture vocale ON' : 'Lecture vocale OFF'}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: ttsEnabled ? '#D4AF37' : '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
                }}
              >
                {ttsEnabled ? '🔊' : '🔇'}
              </button>
              <button onClick={resetConversation} title="Nouvelle conversation" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
              }}>↻</button>
              <button onClick={() => { stopSpeaking(); setIsOpen(false); }} title="Fermer" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
              }}>✕</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: '#475569', fontSize: '13px', padding: '30px 20px' }}>
                <img src={novaAvatar} alt="NOVA" style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  margin: '0 auto 12px', display: 'block', opacity: 0.8,
                }} />
                <p style={{ margin: 0 }}>Salut Julien !</p>
                <p style={{ marginTop: '8px' }}>Pose ta question, parle-moi, ou joins une image/vidéo à classer dans Dropbox.</p>
                <p style={{ marginTop: '12px', fontSize: '11px', color: '#334155' }}>
                  {sttSupported ? '🎤 Micro disponible' : 'Micro non supporté'} · {ttsSupported ? '🔊 Voix disponible' : 'Voix non supportée'}
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={msg.role === 'user' ? {
                alignSelf: 'flex-end',
                background: 'rgba(212,175,55,0.12)',
                border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '12px 12px 4px 12px',
                padding: '10px 14px', maxWidth: '85%',
                color: '#e2e8f0', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              } : {
                alignSelf: 'flex-start',
                background: 'rgba(15,23,42,0.6)',
                border: `1px solid ${msg.isError ? 'rgba(239,68,68,0.4)' : 'rgba(100,116,139,0.2)'}`,
                borderRadius: '12px 12px 12px 4px',
                padding: '10px 14px', maxWidth: '85%',
                color: msg.isError ? '#fca5a5' : '#cbd5e1',
                fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '12px', fontStyle: 'italic', padding: '8px 14px' }}>
                <span style={{ animation: 'pulse 1.5s infinite' }}>●</span> NOVA réfléchit...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {confirmation && (
            <div style={{
              margin: '0 12px 8px', padding: '10px 12px', borderRadius: '10px',
              border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.08)',
            }}>
              <p style={{ margin: 0, color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>Confirmation sécurisée requise</p>
              <p style={{ margin: '5px 0 9px', color: '#cbd5e1', fontSize: '11px' }}>{confirmation.summary || confirmation.type || 'Action Cockpit'}</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={() => executeConfirmation('Je confirme')} disabled={loading} style={{ border: 0, borderRadius: '7px', padding: '7px 10px', background: '#D4AF37', color: '#0B0B0F', fontSize: '11px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
                  {loading ? 'Exécution…' : 'Confirmer et exécuter'}
                </button>
                <button type="button" onClick={() => setConfirmation(null)} disabled={loading} style={{ border: '1px solid #475569', borderRadius: '7px', padding: '7px 10px', background: 'transparent', color: '#cbd5e1', fontSize: '11px', cursor: loading ? 'not-allowed' : 'pointer' }}>Annuler</button>
              </div>
            </div>
          )}

          {/* Zone de saisie */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid rgba(212,175,55,0.2)',
            display: 'flex', gap: '6px', alignItems: 'flex-end',
          }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,.m4v"
              onChange={(event) => handleFileUpload(event.target.files)}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Envoyer des images ou vidéos à NOVA"
              disabled={loading || uploading}
              style={{
                background: '#1e293b', border: '1px solid rgba(100,116,139,0.3)',
                borderRadius: '10px', padding: '10px', cursor: (loading || uploading) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: '40px', height: '40px', fontSize: '16px', opacity: (loading || uploading) ? 0.5 : 1,
              }}
            >
              {uploading ? '⏳' : '📎'}
            </button>
            {sttSupported && (
              <button
                onClick={toggleVoice}
                title={isListening ? 'Arrêt écoute' : 'Parler à NOVA'}
                disabled={loading}
                style={{
                  background: isListening ? 'rgba(6,182,212,0.15)' : '#1e293b',
                  border: `1px solid ${isListening ? '#06B6D4' : 'rgba(100,116,139,0.3)'}`,
                  borderRadius: '10px', padding: '10px', cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: '40px', height: '40px', fontSize: '16px',
                }}
              >
                {isListening ? '⏹' : '🎤'}
              </button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? 'Écoute en cours...' : 'Écris ton message...'}
              rows={1}
              disabled={loading || isListening}
              style={{
                flex: 1, background: '#0F172A',
                border: '1px solid rgba(100,116,139,0.3)',
                borderRadius: '10px', padding: '10px 14px',
                color: '#e2e8f0', fontSize: '13px', outline: 'none',
                resize: 'none', fontFamily: 'inherit',
                maxHeight: '80px', minHeight: '40px',
              }}
            />
            <button
              onClick={() => doSend()}
              disabled={loading || !input.trim()}
              style={{
                background: 'linear-gradient(135deg, #D4AF37 0%, #b8941f 100%)',
                border: 'none', borderRadius: '10px', padding: '0 14px',
                cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                color: '#0B0B0F', fontSize: '16px', fontWeight: 600,
                minWidth: '40px', height: '40px', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                opacity: (loading || !input.trim()) ? 0.5 : 1,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </>
  );
};

export default FloatingAgent;
