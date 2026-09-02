const crypto = require('node:crypto');
const express = require('express');
const { storeBuffer, isDropboxConfigured } = require('./server-documents.cjs');
const { decodePdfBase64, parseSupplierInvoiceText, safePdfFilename } = require('./server-supplier-invoice.cjs');

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';

async function extractPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return {
    text: String(result.text || '').slice(0, 100_000),
    pages: Number(result.numpages || 0),
    info: result.info && typeof result.info === 'object' ? result.info : {},
  };
}

function resolveUploadOrganisation(user) {
  return String(user?.organisation || 'jsinnovia')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'jsinnovia';
}

async function findExistingDocument(fingerprint, organisation) {
  if (!AGENT_KEY) return null;
  try {
    const scopedOrganisation = resolveUploadOrganisation({ organisation });
    const query = new URLSearchParams({
      organisation: scopedOrganisation,
      sort: 'created_at',
      order: 'desc',
      limit: '1000',
    });
    const response = await fetch(`${AGENT_URL.replace(/\/$/, '')}/data/DocumentIndex?${query.toString()}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': AGENT_KEY,
        'x-organisation-id': scopedOrganisation,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => []);
    const marker = `nova-pdf:${fingerprint}`;
    return response.ok && Array.isArray(data)
      ? data.find((row) => (
        String(row?.organisation || row?.tenant_id || '') === scopedOrganisation
        && String(row?.email_message_id || '') === marker
        && !row?.deleted_at
      )) || null
      : null;
  } catch {
    return null;
  }
}

function publicDocument(document, fingerprint, duplicate = false) {
  return {
    id: document?.id || null,
    filename: document?.filename || null,
    dropbox_path: document?.dropbox_path || null,
    dropbox_file_id: document?.dropbox_file_id || null,
    content_hash: fingerprint,
    duplicate,
  };
}

function installNovaDocumentRoutes(router) {
  if (!router?.post || router.__novaDocumentUploadInstalled) return router;
  Object.defineProperty(router, '__novaDocumentUploadInstalled', { value: true });

  router.post('/upload-document', express.json({ limit: '22mb' }), async (req, res) => {
    if (req.user?.role === 'client') {
      return res.status(403).json({ error: 'Le dépôt de factures fournisseurs est réservé à l’équipe interne.' });
    }
    try {
      if (!isDropboxConfigured()) return res.status(503).json({ error: 'Dropbox n’est pas configuré sur le Cockpit.' });
      const fileName = safePdfFilename(req.body?.fileName);
      const mimeType = String(req.body?.mimeType || 'application/pdf').toLowerCase();
      if (!['application/pdf', 'application/octet-stream'].includes(mimeType)) {
        return res.status(415).json({ error: 'Cette route accepte uniquement les factures PDF.' });
      }
      const buffer = decodePdfBase64(req.body?.fileData, MAX_PDF_BYTES);
      const fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
      const organisation = resolveUploadOrganisation(req.user);
      const existing = await findExistingDocument(fingerprint, organisation);
      const parsed = await extractPdf(buffer);
      const invoice = parseSupplierInvoiceText(parsed.text, fileName);

      let document = existing;
      if (!document) {
        document = await storeBuffer({
          user: req.user,
          organisation,
          brand: 'js-innov-ia',
          clientId: null,
          category: 'factures-fournisseurs',
          filename: fileName,
          mimeType: 'application/pdf',
          buffer,
          source: 'nova-document-upload',
          emailMessageId: `nova-pdf:${fingerprint}`,
        });
      }

      return res.status(existing ? 200 : 201).json({
        success: true,
        duplicate: Boolean(existing),
        document: publicDocument(document, fingerprint, Boolean(existing)),
        invoice,
        extraction: {
          status: parsed.text.trim() ? 'text_extracted' : 'text_unavailable',
          pages: parsed.pages,
          preview: parsed.text.slice(0, 12_000),
        },
        allocation: {
          status: 'requires_review',
          client_id: null,
          project_id: null,
          reason: invoice.provider === 'Railway Corporation'
            ? 'La facture Railway est globale. La ventilation par projet/service doit être vérifiée avant toute refacturation.'
            : 'Aucun client n’est attribué automatiquement sans preuve métier.',
        },
        next_actions: ['review_allocation', 'create_verified_cost_events', 'generate_draft_after_separate_confirmation'],
        journal_id: `nova-document-${crypto.randomUUID()}`,
      });
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error).slice(0, 500) });
    }
  });
  return router;
}

module.exports = { extractPdf, findExistingDocument, installNovaDocumentRoutes, resolveUploadOrganisation, MAX_PDF_BYTES };
