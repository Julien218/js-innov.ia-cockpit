const publicNames = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'VITE_AVATAR_FACTORY_URL', 'VITE_AVATAR_REFERENCE_UPLOAD_URL', 'VITE_AVATAR_PREVIEW_URL',
];

export function isPublicSupabaseKey(value) {
  if (value.startsWith('sb_publishable_')) return true;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch { return false; }
}

export function publicEnvDefinitions(env = {}) {
  const key = String(env.VITE_SUPABASE_ANON_KEY || '');
  if (key && !isPublicSupabaseKey(key)) {
    throw new Error('VITE_SUPABASE_ANON_KEY doit être une clé publique anon/publishable ; valeur masquée.');
  }
  return Object.fromEntries(publicNames.map((name) => [`import.meta.env.${name}`, JSON.stringify(String(env[name] || ''))]));
}
