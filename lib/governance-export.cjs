const EXPORT_FIELDS = {
  Client: ['id', 'nom', 'prenom', 'email', 'telephone', 'adresse', 'code_postal', 'ville', 'pays', 'societe', 'entreprise', 'created_at', 'updated_at'],
  Lead: ['id', 'nom', 'prenom', 'email', 'telephone', 'societe', 'entreprise', 'source', 'statut', 'status', 'message', 'created_at', 'updated_at'],
  Demande: ['id', 'nom', 'prenom', 'email', 'telephone', 'objet', 'type', 'statut', 'status', 'message', 'created_at', 'updated_at'],
  DocumentIndex: ['id', 'client_id', 'filename', 'mime_type', 'size_bytes', 'created_at', 'updated_at'],
};

const NEVER_EXPORT_FIELDS = new Set([
  'password', 'password_hash', 'secret', 'token', 'access_token', 'refresh_token',
  'api_key', 'service_role_key', 'dropbox_path', 'dropbox_rev', 'storage_path',
]);

function pickExportFields(rows, entityType) {
  const allowed = EXPORT_FIELDS[entityType] || [];
  return (Array.isArray(rows) ? rows : []).map((row) => Object.fromEntries(
    allowed.filter((field) => Object.hasOwn(row || {}, field)).map((field) => [field, row[field]])
  ));
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !NEVER_EXPORT_FIELDS.has(field.toLowerCase()))
      .map(([field, nested]) => [field, sanitizeValue(nested)])
  );
}

function sanitizeTenantExport(rows) {
  return (Array.isArray(rows) ? rows : []).map(sanitizeValue);
}

module.exports = { pickExportFields, sanitizeTenantExport };
