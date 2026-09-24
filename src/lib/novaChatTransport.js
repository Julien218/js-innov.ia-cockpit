export function isDropboxDeletionRequest(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /supprim|effac|effec|\bdelete\b/.test(text) && /dropbox|fichier|image|photo|document|\.png|\.jpg|\.pdf|\.mp4/.test(text);
}

export function localMediaDiagnosticRequest(message) {
  const raw = String(message || '');
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const windowsMediaPath = /(?:^|[\s"'(<])(?:[a-z]:\\|\\\\)[^\r\n"'<>|?*]+\.(?:mp4|mov|m4v|avi|mkv|webm|mp3|wav|m4a|aac|flac)(?=$|[\s"'),>])/i.test(raw);
  const mediaDiagnosticIntent = /\b(?:video|audio|media|fichier|montage|studio|codec|ffmpeg|ffprobe|import|importer|ajout|ajouter|integrit|corromp|lisible|lecture|diagnosti|verifi|controle|analyse)\b/.test(text);
  return windowsMediaPath && mediaDiagnosticIntent;
}

export async function sendNovaChat({ message, offline, requiresLocalTool, sendCloud, sendLocal }) {
  const needsDropboxProof = isDropboxDeletionRequest(message);
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needsEmailProof = /\b(tri(?:er|e|ez|ller)?|class(?:er|e|ez|ement)|rang(?:er|e|ez)|organis(?:er|e|ez))\b/.test(text) && /\b(e[- ]?mails?|courriels?|courriers?|boites? mail)\b/.test(text);
  const needsLocalMediaDiagnostic = localMediaDiagnosticRequest(message);
  const needsConnectedRead = !needsDropboxProof && !needsEmailProof && /\b(dropbox|github|preferences|telecharg\w*)\b/.test(text);
  if (needsConnectedRead && offline) throw Object.assign(new Error('Cette demande nécessite les outils connectés du Cockpit.'), { cockpitResponse: true });
  if (needsEmailProof && offline) throw Object.assign(new Error('Une connexion au Cockpit est nécessaire pour consulter la boîte mail. Aucun préclassement effectué.'), { emailVerification: true });
  if (needsDropboxProof && offline) {
    throw Object.assign(new Error('Une connexion au Cockpit est nécessaire. Aucune suppression lancée depuis ce chat.'), { dropboxVerification: true });
  }
  // Un chemin C:\\... appartient au poste Windows : le cloud ne peut pas lire ce fichier.
  // Elynea bascule donc directement vers le pont local (FFprobe/FFmpeg) sans demander de confirmation.
  if (!needsConnectedRead && !needsDropboxProof && !needsEmailProof && (needsLocalMediaDiagnostic || requiresLocalTool || offline)) return sendLocal();
  try {
    return await sendCloud();
  } catch (error) {
    if (error?.cockpitResponse) throw error;
    if (needsConnectedRead) throw Object.assign(new Error('L’outil connecté n’a pas pu répondre. Aucun résultat vérifié.'), { cockpitResponse: true });
    if (needsEmailProof) throw Object.assign(new Error('La boîte mail n’a pas pu être vérifiée. Réessayez après rétablissement de la connexion.'), { emailVerification: true });
    if (needsDropboxProof) {
      throw Object.assign(new Error('Connexion interrompue. Le résultat Dropbox est inconnu ; renvoyez la même demande exacte pour vérifier et terminer la synchronisation.'), { dropboxVerification: true });
    }
    return sendLocal();
  }
}
