export function mailboxErrorMessage(error) {
  const message = String(error?.message || error || 'Erreur de chargement de la boîte mail.');
  if (/authenticat|invalid.credentials|login.failed/i.test(message)) {
    return 'Connexion à cette boîte mail refusée. Vérifiez ses identifiants IMAP dans la configuration sécurisée du serveur, ou reconnectez le compte Google concerné. Aucune nouvelle tentative automatique ne corrigera ces identifiants.';
  }
  return message;
}
