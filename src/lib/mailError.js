export function mailboxErrorMessage(error) {
  const message = String(error?.message || error || 'Erreur de chargement de la boîte mail.');
  if (error?.code === 'html_instead_of_json' || /page HTML.*JSON|unexpected token\s*['"]?</i.test(message)) {
    return 'Le service Boîtes mail n’a pas répondu en JSON. En local, vérifiez que l’API Cockpit fonctionne sur 127.0.0.1:3001 et que le proxy /api est actif.';
  }
  if (error?.code === 'session_required' || /session.*(?:expir|requise|absente)/i.test(message)) {
    return 'La session Cockpit n’est plus valide. Reconnectez-vous avant d’actualiser les boîtes mail.';
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Connexion au service mail indisponible. Les derniers messages synchronisés restent affichés en mode hors ligne lorsqu’un cache local existe.';
  }
  if (/authenticat|invalid.credentials|login.failed/i.test(message)) {
    return 'Connexion à cette boîte mail refusée. Vérifiez ses identifiants IMAP dans la configuration sécurisée du serveur, ou reconnectez le compte Google concerné. Aucune nouvelle tentative automatique ne corrigera ces identifiants.';
  }
  return message;
}
