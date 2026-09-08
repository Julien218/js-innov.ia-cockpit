function parseRecurrence(value) {
  if (!value) return 'none';
  if (typeof value === 'string') return value;
  return String(value.type || 'none');
}

function sanitizeSignelyaProgramContext(req, _res, next) {
  try {
    if (req.body?.surface !== 'signelya' || !req.body?.signelya_context || typeof req.body.signelya_context !== 'object') return next();
    const context = req.body.signelya_context;
    const playlists = Array.isArray(context.playlists) ? context.playlists : [];
    const publications = Array.isArray(context.publications) ? context.publications : [];
    const playlistById = new Map(playlists.map(item => [String(item.id || ''), item]));

    const active = publications.find(item => item.status === 'active') || null;
    const futureCandidates = publications.filter(item => {
      if (item.status !== 'pending') return false;
      if (parseRecurrence(item.recurrence) !== 'none') return false;
      const timestamp = new Date(item.scheduledAt || 0).getTime();
      return Number.isFinite(timestamp) && timestamp > Date.now() - 60_000;
    });
    const nextReplacement = futureCandidates[0] || null;
    const currentPlaylist = active ? playlistById.get(String(active.playlistId || '')) || null : null;
    const nextPlaylist = nextReplacement ? playlistById.get(String(nextReplacement.playlistId || '')) || null : null;
    const usedIds = new Set([currentPlaylist?.id, nextPlaylist?.id].filter(Boolean).map(String));
    const history = playlists.filter(item => !usedIds.has(String(item.id || '')));

    context.programPolicy = {
      mode: 'single_current_program',
      rule: 'Un seul programme est diffusé par Player. Le dernier programme validé remplace le précédent. Les anciennes playlists sont uniquement un historique et ne sont jamais diffusées en parallèle.',
      scheduleRule: 'Les horaires hebdomadaires commandent l’arrêt et la reprise du même programme courant. Il ne faut pas créer une nouvelle publication quotidienne pour répéter la boucle.',
      futureRule: 'Si un nouveau programme possède une date future, le programme courant continue jusque-là puis est remplacé à cette heure. Seul le dernier remplacement futur enregistré est conservé.',
    };
    context.currentProgram = currentPlaylist ? {
      id: currentPlaylist.id,
      name: currentPlaylist.name,
      mediaCount: currentPlaylist.mediaCount,
      status: 'current',
      activatedAt: active?.scheduledAt || null,
    } : null;
    context.nextProgram = nextPlaylist ? {
      id: nextPlaylist.id,
      name: nextPlaylist.name,
      mediaCount: nextPlaylist.mediaCount,
      status: 'scheduled_replacement',
      scheduledAt: nextReplacement?.scheduledAt || null,
    } : null;
    context.programHistory = {
      count: history.length,
      recent: history.slice(0, 5).map(item => ({ id: item.id, name: item.name, mediaCount: item.mediaCount, status: 'history_only' })),
    };

    context.playlists = [
      ...(currentPlaylist ? [{ ...currentPlaylist, role: 'current' }] : []),
      ...(nextPlaylist && String(nextPlaylist.id) !== String(currentPlaylist?.id) ? [{ ...nextPlaylist, role: 'scheduled_replacement' }] : []),
    ];
    context.publications = [
      ...(active ? [{ ...active, recurrence: 'none', role: 'current' }] : []),
      ...(nextReplacement ? [{ ...nextReplacement, recurrence: 'none', role: 'scheduled_replacement' }] : []),
    ];
  } catch (error) {
    console.warn('[elynea][signelya-policy] context normalization failed:', error.message);
  }
  next();
}

module.exports = sanitizeSignelyaProgramContext;
