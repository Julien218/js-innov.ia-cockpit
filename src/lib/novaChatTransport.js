function userMessage(message) {
  return String(message || '').replace(/\n?\[(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)[^\]]*\][\s\S]*?\[\/(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)\]/gi, '').trim();
}
export function isDropboxDeletionRequest(message) {
  const text = userMessage(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /supprim|effac|effec|\bdelete\b/.test(text) && /dropbox|fichier|image|photo|document|\.png|\.jpg|\.pdf|\.mp4/.test(text);
}
export function localMediaDiagnosticRequest(message) {
  const raw = userMessage(message);
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const windowsMediaPath = /(?:^|[\s"'(<])(?:[a-z]:\\|\\\\)[^\r\n"'<>|?*]+\.(?:mp4|mov|m4v|avi|mkv|webm|mp3|wav|m4a|aac|flac)(?=$|[\s"'),>])/i.test(raw);
  const mediaDiagnosticIntent = /\b(?:video|audio|media|fichier|montage|studio|codec|ffmpeg|ffprobe|import|importer|ajout|ajouter|integrit|corromp|lisible|lecture|diagnosti|verifi|controle|analyse)\b/.test(text);
  return windowsMediaPath && mediaDiagnosticIntent;
}
export async function sendNovaChat({ message, offline, requiresLocalTool, sendCloud, sendLocal }) {
  const needsDropboxProof = isDropboxDeletionRequest(message);
  const text = userMessage(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ');
  const reads = /\b(?:liste|listes|lister|lis|affiche|montre|consulte|cherche|recherche|retrouve|verifie|quels|quelles)\b/.test(text);
  const needsEmailProof = /\b(?:tri(?:er|e|ez|ller)?|class(?:er|e|ez|ement)|rang(?:er|e|ez)|organis(?:er|e|ez)|envoie|envoyer|supprime|archive)\b/.test(text) && /\b(?:e[- ]?mails?|courriels?|courriers?|boites? mail)\b/.test(text)
    || reads && /\b(?:e[- ]?mails?|mails?|courriels?|gmail|boites? mail)\b/.test(text);
  const needsConfirmationProof = !requiresLocalTool && /^(?:je confirme\b|confirme\b|oui[.!\s]*$|ok[.!\s]*$|oki[.!\s]*$)/.test(text);
  const needsLocalMediaDiagnostic = localMediaDiagnosticRequest(message);
  const explicitLocalMedia = /\b(?:en local|en locale|localement|hors ligne|local only)\b/.test(text)
    && /\b(?:genere|generer|cree|creer|realise|realiser|produis|produire|anime|animer|montage)\b/.test(text)
    && /\b(?:images?|videos?|visuels?|animation|montage)\b/.test(text);
  const needsConnectedRead = !needsDropboxProof && !needsEmailProof && (
    /\b(?:dropbox|github|preferences|telecharg\w*)\b/.test(text)
    || reads && /\b(?:taches?|projets?|factures?|devis|agenda|calendrier|railway)\b/.test(text)
  );
  if ((needsConnectedRead || needsConfirmationProof) && offline) throw Object.assign(new Error('Cette demande nécessite les outils connectés du Cockpit. Aucun résultat ni aucune exécution ne seront simulés localement.'), { cockpitResponse: true });
  if (needsEmailProof && offline) throw Object.assign(new Error('Une connexion au Cockpit est nécessaire pour consulter la boîte mail. Aucun préclassement effectué.'), { emailVerification: true });
  if (needsDropboxProof && offline) throw Object.assign(new Error('Une connexion au Cockpit est nécessaire. Aucune suppression lancée depuis ce chat.'), { dropboxVerification: true });
  // A local generation or Windows path must not silently turn into a cloud request.
  if (!needsConnectedRead && !needsDropboxProof && !needsEmailProof && (needsLocalMediaDiagnostic || explicitLocalMedia || requiresLocalTool || offline)) return sendLocal();
  try {
    return await sendCloud();
  } catch (error) {
    if (error?.cockpitResponse) throw error;
    if (needsConnectedRead || needsConfirmationProof) throw Object.assign(new Error('L’outil connecté n’a pas pu répondre. Aucun résultat vérifié ; la même action ne sera pas relancée par un autre moteur.'), { cockpitResponse: true });
    if (needsEmailProof) throw Object.assign(new Error('La boîte mail n’a pas pu être vérifiée. Réessayez après rétablissement de la connexion.'), { emailVerification: true });
    if (needsDropboxProof) throw Object.assign(new Error('Connexion interrompue. Le résultat Dropbox est inconnu ; renvoyez la même demande exacte pour vérifier et terminer la synchronisation.'), { dropboxVerification: true });
    return sendLocal();
  }
}
