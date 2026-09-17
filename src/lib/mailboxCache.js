const CACHE_PREFIX = 'cockpit_mailbox_cache_v2';
const MAX_MESSAGES = 50;

function key(mailboxId, folder) {
  return `${CACHE_PREFIX}:${String(mailboxId || 'unknown')}:${String(folder || 'inbox')}`;
}

function compactEmail(email = {}) {
  return {
    uid: email.uid,
    from: email.from || '',
    to: email.to || '',
    subject: email.subject || '',
    date: email.date || null,
    seen: Boolean(email.seen),
    hasAttachment: Boolean(email.hasAttachment || email.has_attachment),
    body: String(email.body || email.preview || '').slice(0, 800),
    preview: String(email.preview || email.body || '').slice(0, 800),
    messageId: email.messageId || email.message_id || '',
  };
}

export function readMailboxCache(mailboxId, folder = 'inbox') {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key(mailboxId, folder)) || 'null');
    if (!parsed || !Array.isArray(parsed.emails) || !parsed.syncedAt) return null;
    return {
      syncedAt: parsed.syncedAt,
      emails: parsed.emails.slice(0, MAX_MESSAGES),
    };
  } catch {
    return null;
  }
}

export function writeMailboxCache(mailboxId, folder = 'inbox', emails = []) {
  if (typeof localStorage === 'undefined') return null;
  const payload = {
    syncedAt: new Date().toISOString(),
    emails: (Array.isArray(emails) ? emails : []).slice(0, MAX_MESSAGES).map(compactEmail),
  };
  try {
    localStorage.setItem(key(mailboxId, folder), JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function formatMailboxSyncTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
