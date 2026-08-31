export const MAIL_CATEGORIES = {
  all: 'Tous', invoices: 'Factures', requests: 'Demandes / devis',
  client_records: 'Dossiers clients', notifications: 'Notifications', promotions: 'Promotions', other: 'Autres',
};

export function mailCategory(email) {
  const key = email?.classification?.category;
  return key !== 'all' && Object.hasOwn(MAIL_CATEGORIES, key) ? key : 'other';
}

export function mailCategoryCounts(emails) {
  const counts = Object.fromEntries(Object.keys(MAIL_CATEGORIES).map(key => [key, 0]));
  for (const email of emails) { counts.all++; counts[mailCategory(email)]++; }
  return counts;
}

export function filterMailboxEmails(emails, category, search) {
  const term = String(search || '').toLocaleLowerCase();
  return emails.filter(email => (category === 'all' || mailCategory(email) === category)
    && (!term || [email.subject, email.from, email.to].some(value => String(value || '').toLocaleLowerCase().includes(term))));
}
