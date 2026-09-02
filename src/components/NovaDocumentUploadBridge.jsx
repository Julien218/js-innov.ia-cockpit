import { useCallback, useEffect, useState } from 'react';
import { FileCheck2, FileWarning, Loader2, X } from 'lucide-react';

const NOVA_INPUT_MARKER = 'nova-document-bridge';
const RECENT_MEDIA_KEY = 'nova_recent_media_v1';
const CHAT_MESSAGES_KEY = 'agent_chat_messages';
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function isPdf(file) {
  return Boolean(file && (file.type === 'application/pdf' || String(file.name || '').toLowerCase().endsWith('.pdf')));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le PDF sélectionné.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const separator = value.indexOf(',');
      resolve(separator >= 0 ? value.slice(separator + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function money(value, currency = 'EUR') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'non détecté';
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: currency || 'EUR' }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency || ''}`.trim();
  }
}

function appendPersistentMessages(userContent, assistantContent) {
  try {
    const current = JSON.parse(localStorage.getItem(CHAT_MESSAGES_KEY) || '[]');
    const messages = Array.isArray(current) ? current : [];
    messages.push(
      { role: 'user', content: userContent, ts: Date.now(), isFile: true },
      { role: 'assistant', content: assistantContent, ts: Date.now() + 1 },
    );
    localStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(messages.slice(-50)));
    window.dispatchEvent(new Event('storage'));
  } catch { /* Le panneau de résultat reste visible si le stockage navigateur est indisponible. */ }
}

function invoiceSummary(data, fileName) {
  const invoice = data.invoice || {};
  const document = data.document || {};
  const duplicate = data.duplicate ? ' · déjà archivée, aucun doublon créé' : '';
  const lines = [
    `✅ Facture fournisseur analysée${duplicate}`,
    '',
    `📄 ${fileName}`,
    `🏢 Fournisseur : ${invoice.provider || 'non identifié'}`,
    `🧾 Numéro : ${invoice.invoice_number || 'non détecté'}`,
    `📅 Période : ${invoice.period || invoice.service_period || 'non détectée'}`,
    `💰 Coût fournisseur : ${money(invoice.cost_basis_amount, invoice.currency)}`,
    `💳 Montant restant dû : ${money(invoice.payment_basis_amount, invoice.currency)}`,
  ];
  if (invoice.applied_balance !== null && invoice.applied_balance !== undefined) {
    lines.push(`↪️ Solde/avoir appliqué : ${money(invoice.applied_balance, invoice.currency)}`);
  }
  lines.push(
    `📂 Dropbox : ${document.dropbox_path || 'archivage non confirmé'}`,
    `🗂️ Document : ${document.id || 'index non confirmé'}`,
    '',
    `⚠️ Attribution client : ${data.allocation?.reason || 'validation humaine requise avant toute refacturation.'}`,
    'Aucun coût client et aucune facture client ne sont créés automatiquement à ce stade.',
  );
  return lines.join('\n');
}

export default function NovaDocumentUploadBridge() {
  const [uploads, setUploads] = useState([]);

  const processFile = useCallback(async (file) => {
    const id = `${Date.now()}-${file.name}`;
    setUploads((current) => [...current, { id, fileName: file.name, status: 'loading', message: 'Analyse et archivage en cours…' }]);
    try {
      if (file.size > MAX_PDF_BYTES) throw new Error('PDF trop volumineux : maximum 15 Mo.');
      const fileData = await fileToBase64(file);
      const response = await fetch('/api/assistant/upload-document', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          fileData,
          context: 'Facture fournisseur à analyser, archiver et préparer pour attribution client/refacturation.',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Traitement PDF impossible (HTTP ${response.status})`);

      const summary = invoiceSummary(data, file.name);
      const recentDocument = {
        originalFileName: file.name,
        fileName: data.document?.filename || file.name,
        mediaType: 'Facture fournisseur',
        title: `${data.invoice?.provider || 'Fournisseur'} ${data.invoice?.invoice_number || file.name}`,
        dropboxPath: data.document?.dropbox_path || '',
        documentId: data.document?.id || '',
        contentHash: data.document?.content_hash || '',
        invoice: data.invoice || null,
        allocation: data.allocation || null,
        storedAt: new Date().toISOString(),
      };
      try { localStorage.setItem(RECENT_MEDIA_KEY, JSON.stringify(recentDocument)); } catch {}
      appendPersistentMessages(`📎 ${file.name} (${Math.ceil(file.size / 1024)} Ko)`, summary);
      fetch('/api/assistant/history/append', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [
          { role: 'user', content: `Facture fournisseur jointe : ${file.name}` },
          { role: 'assistant', content: summary },
        ] }),
      }).catch(() => null);
      window.dispatchEvent(new CustomEvent('nova-document-uploaded', { detail: data }));
      setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'success', message: summary } : item));
    } catch (error) {
      setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'error', message: String(error.message || error) } : item));
    }
  }, []);

  useEffect(() => {
    const patchInputs = () => {
      document.querySelectorAll('input[type="file"][multiple]').forEach((input) => {
        const accept = String(input.getAttribute('accept') || '');
        if (!accept.includes('video/x-matroska')) return;
        input.dataset[NOVA_INPUT_MARKER] = 'true';
        if (!accept.includes('application/pdf')) input.setAttribute('accept', `${accept},application/pdf,.pdf`);
        const button = input.parentElement?.querySelector('button[title*="Envoyer"]');
        if (button) button.setAttribute('title', 'Envoyer des images, vidéos ou factures PDF à NOVA');
      });
    };

    patchInputs();
    const observer = new MutationObserver(patchInputs);
    observer.observe(document.body, { childList: true, subtree: true });

    const intercept = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset[NOVA_INPUT_MARKER] !== 'true') return;
      const files = Array.from(input.files || []);
      const pdfs = files.filter(isPdf);
      if (!pdfs.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      input.value = '';
      pdfs.forEach((file) => void processFile(file));
      if (files.length !== pdfs.length) {
        setUploads((current) => [...current, {
          id: `${Date.now()}-mixed`, fileName: 'Sélection mixte', status: 'error',
          message: 'Les PDF ont été traités. Envoie les images/vidéos séparément pour éviter un classement ambigu.',
        }]);
      }
    };
    document.addEventListener('change', intercept, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('change', intercept, true);
    };
  }, [processFile]);

  if (!uploads.length) return null;
  return (
    <aside style={{
      position: 'fixed', right: 22, bottom: 84, zIndex: 100002, width: 'min(430px, calc(100vw - 32px))',
      maxHeight: '62vh', overflowY: 'auto', borderRadius: 14, border: '1px solid rgba(212,175,55,.42)',
      background: '#08111f', boxShadow: '0 18px 60px rgba(0,0,0,.55)', color: '#e2e8f0', padding: 12,
      fontFamily: 'Inter, -apple-system, sans-serif',
    }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <strong style={{ color: '#D4AF37', fontSize: 13 }}>NOVA · Factures PDF</strong>
        <button type="button" onClick={() => setUploads([])} title="Fermer" style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {uploads.map((item) => (
          <div key={item.id} style={{ border: '1px solid rgba(148,163,184,.18)', borderRadius: 10, padding: 10, background: 'rgba(15,23,42,.78)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {item.status === 'loading' ? <Loader2 size={16} style={{ animation: 'novaPdfSpin 1s linear infinite' }} /> : item.status === 'success' ? <FileCheck2 size={16} color="#34d399" /> : <FileWarning size={16} color="#f87171" />}
              <strong style={{ fontSize: 12, wordBreak: 'break-word' }}>{item.fileName}</strong>
            </div>
            <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 11, lineHeight: 1.45, color: item.status === 'error' ? '#fca5a5' : '#cbd5e1' }}>{item.message}</pre>
          </div>
        ))}
      </div>
      <style>{`@keyframes novaPdfSpin{to{transform:rotate(360deg)}}`}</style>
    </aside>
  );
}
