const { labels, aliases } = require('./demande-status.json');

function normalizeDemandeWrite(payload = {}, method = 'PATCH') {
  if (!Object.hasOwn(payload, 'statut')) return method === 'POST' ? { ...payload, statut: 'nouveau' } : payload;
  const value = payload.statut;
  const normalized = typeof value === 'string' && Object.hasOwn(aliases, value) ? aliases[value] : value;
  if (typeof normalized !== 'string' || !Object.hasOwn(labels, normalized)) {
    const error = new Error('Statut de demande invalide. Choisissez Nouvelle, Lue, En cours, Traitée ou Archivée.');
    error.status = 422;
    throw error;
  }
  return { ...payload, statut: normalized };
}

module.exports = { normalizeDemandeWrite };
