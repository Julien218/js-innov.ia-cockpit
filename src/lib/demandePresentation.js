const STATUS_ALIASES = { ouverte: 'nouveau', en_traitement: 'en_cours', resolue: 'traite' };

export function demandeStatus(demande) {
  return STATUS_ALIASES[demande.statut] || demande.statut || '';
}

export function isNewDemande(demande) {
  return demandeStatus(demande) === 'nouveau';
}

export function demandeOrigin(demande) {
  // Only use provenance explicitly recorded; a website mentioned in the subject
  // or the contact's email domain is not evidence of where a request came from.
  if (demande.type === 'elynea_commerciale') {
    const site = demande.message?.match(/^Demande qualifiée par Elynea depuis ([^\s]+)\./i)?.[1];
    return site ? `Elynea — ${site}` : 'Elynea — site web';
  }
  if (/Demande reçue via agent IA/i.test(demande.message || '')) return 'Agent IA (indiqué dans la demande)';
  return 'Origine non renseignée';
}

export function demandeTitle(demande) {
  return ({ contact: 'Contact', elynea_commerciale: 'Demande qualifiée par Elynea',
    demande_devis: 'Demande de devis', support: 'Support', autre: 'Autre demande' })[demande.type] || 'Demande';
}

export function demandeFormData(demande = {}) {
  return Object.fromEntries(['nom', 'email', 'telephone', 'entreprise', 'message', 'type', 'statut']
    .map(key => [key, key === 'statut' ? demandeStatus(demande) || 'nouveau'
      : key === 'type' ? demande.type || 'contact' : demande[key] || '']));
}
