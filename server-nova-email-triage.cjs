const { hasPermission } = require('./server-permission-policy.cjs');
const { cleanTenant } = require('./server-tenant.cjs');
const { classifyEmail } = require('./server-email-accounting-core.cjs');
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clean = value => String(value || '').replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 200);

function isEmailTriage(message) {
  const text = norm(message);
  return /\b(tri(?:er|e|ez|ller)?|class(?:er|e|ez|ement)|rang(?:er|e|ez)|organis(?:er|e|ez))\b/.test(text)
    && /\b(e[- ]?mails?|courriels?|courriers?|boites? mail)\b/.test(text);
}

function dependencies() {
  const imap = require('./server-email.cjs');
  const google = require('./server-google-mail.cjs');
  return {
    async mailboxes() {
      const boxes = ['jsinnovia', 'assurances', 'store'].map(id => ({ id, ...imap.getMailboxConfig(id) }))
        .filter(box => box.password && !box.isAlias).map(({ id, email, label }) => ({ id, email, label }));
      let googleUnavailable = false;
      try {
        for (const account of await google.fetchGoogleAccounts()) boxes.push({ id: `google:${account.id}`, email: account.email, label: account.label || account.email });
      } catch { googleUnavailable = true; }
      return { boxes, googleUnavailable };
    },
    async read(mailbox) {
      if (mailbox.startsWith('google:')) return { emails: await google.fetchGoogleEmails(mailbox.slice(7), 'in:inbox -in:trash', 50) };
      return imap.fetchEmails(mailbox, { folder: 'INBOX', limit: 50 });
    },
  };
}

async function triageEmails({ message, user, mailbox, deps = dependencies() }) {
  const result = { success: false, action_type: 'email_triage_preview', confirmation: null };
  if (!user?.id || !['admin', 'superadmin'].includes(user.role) || !hasPermission(user, 'emails') || cleanTenant(user.organisation) !== 'jsinnovia') {
    return { ...result, content: 'Accès au tri des emails refusé : permission E-mails et organisation autorisée requises.' };
  }
  if (/\b(ne|pas|sans|annule|stop)\b/.test(norm(message))) return { ...result, content: 'Aucun préclassement lancé. Aucune tâche ni aucun email modifié.' };
  try {
    const { boxes, googleUnavailable } = await deps.mailboxes();
    const text = norm(message);
    const addresses = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    const named = boxes.filter(box => addresses.length ? addresses.includes(norm(box.email)) : (box.label && text.includes(norm(box.label))) || new RegExp(`\\b${box.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    let selected = named.length === 1 && addresses.length <= 1 ? named[0] : !named.length && !addresses.length ? boxes.find(box => box.id === mailbox) : null;
    if (!selected && boxes.length === 1 && !named.length && !addresses.length && !mailbox && !googleUnavailable) selected = boxes[0];
    if (!selected) return { ...result, mailboxes: boxes, content: `Quelle boîte faut-il préclasser ?${boxes.length ? '\n' + boxes.map(box => `- ${box.label} : ${box.email}`).join('\n') : '\nAucune boîte lisible disponible.'}${googleUnavailable ? '\nLes comptes Google sont momentanément indisponibles.' : ''}\nIndique son adresse dans « Trier les emails de … ». Aucun email ni aucune tâche n’a été modifié.` };
    const data = await deps.read(selected.id);
    if (!Array.isArray(data.emails)) throw new Error('Liste de messages non vérifiable');
    const groups = { 'Factures et abonnements — à vérifier': [], 'Demandes et devis — à traiter': [], 'Notifications GitHub': [], 'Autres — à vérifier': [] };
    for (const email of data.emails.slice(0, 50)) {
      const classified = classifyEmail(email);
      const category = /invoice/.test(classified.category) ? 'Factures et abonnements — à vérifier' : classified.category === 'request_or_quote' ? 'Demandes et devis — à traiter' : classified.reason === 'github_operational_notification' ? 'Notifications GitHub' : 'Autres — à vérifier';
      groups[category].push({ uid: clean(email.uid), subject: clean(email.subject || '(sans objet)'), from: clean(email.from) });
    }
    const count = Object.values(groups).reduce((sum, group) => sum + group.length, 0);
    const lines = Object.entries(groups).filter(([, group]) => group.length).map(([category, group]) => `${category} (${group.length})\n${group.map(email => `- ${email.subject} — ${email.from} [${email.uid}]`).join('\n')}`);
    return { ...result, success: true, result: { mailbox: selected.id, email: selected.email, checked_at: new Date().toISOString(), inspected: count, limit: 50, total: Number.isFinite(data.total) ? data.total : null, read_only: true, groups },
      content: `Préclassement de ${selected.email} : ${count} message(s) examiné(s), parmi les 50 plus récents de la boîte de réception.\n${lines.join('\n\n')}\nClassement indicatif basé sur les objets et extraits disponibles. Aucun message déplacé, supprimé, envoyé ou marqué comme lu. Aucune tâche client modifiée.` };
  } catch {
    return { ...result, content: 'Préclassement impossible : la boîte mail est indisponible. Aucun tri réussi n’est attesté et aucune tâche client n’a été modifiée.' };
  }
}

module.exports = { isEmailTriage, triageEmails };
