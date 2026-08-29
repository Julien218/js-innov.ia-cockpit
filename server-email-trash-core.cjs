function normalizedMailboxName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const PROTECTED_CONTENT = [
  'facture', 'invoice', 'receipt', 'recu', 'paiement', 'payment', 'devis', 'quote',
  'commande', 'order', 'contrat', 'contract', 'abonnement', 'subscription',
  'remboursement', 'refund', 'echeance', 'mise en demeure', 'taxe', 'tva', 'vat',
  'demande', 'request', 'rendez-vous', 'support', 'ticket', 'client', 'validation',
  'github', 'railway', 'supabase', 'dropbox', 'twilio', 'openai', 'xai',
];

const PROMOTION_SIGNALS = [
  'newsletter', 'se desabonner', 'unsubscribe', 'offre exclusive', 'promotion',
  'code promo', 'soldes', 'reduction', 'discount', 'bon plan', 'nos nouveautes',
  'profitez', 'derniere chance', 'vente privee', 'black friday',
];

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function senderAddress(value) {
  return String(value || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(value || '').trim().toLowerCase();
}

function isProtectedSender(from, protectedSenders = []) {
  const address = senderAddress(from);
  return protectedSenders.some((entry) => {
    const rule = String(entry || '').trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('@')) return address.endsWith(rule);
    return address === rule || address.endsWith(`@${rule}`);
  });
}

function shouldTrashImapPromotion(email, protectedSenders = []) {
  if (!email || email.hasAttachment || (email.attachments || []).length) return { eligible: false, confidence: 1, reason: 'attachment_protected' };
  if (isProtectedSender(email.from, protectedSenders)) return { eligible: false, confidence: 1, reason: 'protected_sender' };
  const haystack = normalizedText(`${email.subject || ''} ${email.from || ''} ${email.text || email.body || ''}`);
  if (PROTECTED_CONTENT.some((term) => haystack.includes(normalizedText(term)))) return { eligible: false, confidence: 0.99, reason: 'business_or_accounting_signal' };

  const signalCount = PROMOTION_SIGNALS.filter((term) => haystack.includes(normalizedText(term))).length;
  const hasUnsubscribeHeader = Boolean(email.listUnsubscribe);
  if (signalCount >= 2 || (hasUnsubscribeHeader && signalCount >= 1)) {
    return { eligible: true, confidence: hasUnsubscribeHeader ? 0.99 : 0.96, reason: 'high_confidence_promotion' };
  }
  return { eligible: false, confidence: 0, reason: 'insufficient_promotion_evidence' };
}

function flattenMailboxes(boxes, parent = '', output = []) {
  for (const [name, entry] of Object.entries(boxes || {})) {
    const delimiter = entry?.delimiter || '/';
    const fullName = parent ? `${parent}${delimiter}${name}` : name;
    output.push({
      name: fullName,
      attributes: (entry?.attribs || []).map((value) => String(value).toLowerCase()),
    });
    if (entry?.children) flattenMailboxes(entry.children, fullName, output);
  }
  return output;
}

function findTrashMailbox(boxes) {
  const mailboxes = flattenMailboxes(boxes);
  const specialUse = mailboxes.find((mailbox) => mailbox.attributes.includes('\\trash'));
  if (specialUse) return specialUse.name;

  const exactNames = new Set([
    'trash', 'corbeille', 'deleted', 'deleted items', 'deleted messages',
    'elements supprimes', 'messages supprimes', 'papierkorb',
  ]);
  const exact = mailboxes.find((mailbox) => {
    const leaf = normalizedMailboxName(mailbox.name.split(/[/.]/).pop());
    return exactNames.has(leaf);
  });
  return exact?.name || null;
}

module.exports = { flattenMailboxes, findTrashMailbox, shouldTrashImapPromotion, isProtectedSender };
