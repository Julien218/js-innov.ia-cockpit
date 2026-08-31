export function isDropboxDeletionRequest(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /supprim|effac|effec|\bdelete\b/.test(text) && /dropbox|fichier|image|photo|document|\.png|\.jpg|\.pdf|\.mp4/.test(text);
}

export async function sendNovaChat({ message, offline, requiresLocalTool, sendCloud, sendLocal }) {
  const needsDropboxProof = isDropboxDeletionRequest(message);
  if (needsDropboxProof && offline) {
    throw Object.assign(new Error('Une connexion au Cockpit est nécessaire. Aucune suppression lancée depuis ce chat.'), { dropboxVerification: true });
  }
  if (!needsDropboxProof && (requiresLocalTool || offline)) return sendLocal();
  try {
    return await sendCloud();
  } catch (error) {
    if (error?.cockpitResponse) throw error;
    if (needsDropboxProof) {
      throw Object.assign(new Error('Connexion interrompue. Le résultat Dropbox est inconnu ; renvoyez la même demande exacte pour vérifier et terminer la synchronisation.'), { dropboxVerification: true });
    }
    return sendLocal();
  }
}
