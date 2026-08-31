export function isDropboxDeletionRequest(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /supprim|effac|effec|\bdelete\b/.test(text) && /dropbox|fichier|image|photo|document|\.png|\.jpg|\.pdf|\.mp4/.test(text);
}

export async function sendNovaChat({ message, offline, requiresLocalTool, sendCloud, sendLocal }) {
  const needsDropboxProof = isDropboxDeletionRequest(message);
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needsEmailProof = /\b(tri(?:er|e|ez|ller)?|class(?:er|e|ez|ement)|rang(?:er|e|ez)|organis(?:er|e|ez))\b/.test(text) && /\b(e[- ]?mails?|courriels?|courriers?|boites? mail)\b/.test(text);
  if (needsEmailProof && offline) throw Object.assign(new Error('Une connexion au Cockpit est nécessaire pour consulter la boîte mail. Aucun préclassement effectué.'), { emailVerification: true });
  if (needsDropboxProof && offline) {
    throw Object.assign(new Error('Une connexion au Cockpit est nécessaire. Aucune suppression lancée depuis ce chat.'), { dropboxVerification: true });
  }
  if (!needsDropboxProof && !needsEmailProof && (requiresLocalTool || offline)) return sendLocal();
  try {
    return await sendCloud();
  } catch (error) {
    if (error?.cockpitResponse) throw error;
    if (needsEmailProof) throw Object.assign(new Error('La boîte mail n’a pas pu être vérifiée. Réessayez après rétablissement de la connexion.'), { emailVerification: true });
    if (needsDropboxProof) {
      throw Object.assign(new Error('Connexion interrompue. Le résultat Dropbox est inconnu ; renvoyez la même demande exacte pour vérifier et terminer la synchronisation.'), { dropboxVerification: true });
    }
    return sendLocal();
  }
}
