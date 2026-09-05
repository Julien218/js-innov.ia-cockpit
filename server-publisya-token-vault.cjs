const crypto = require('node:crypto');

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function rawSecret() {
  return String(process.env.PUBLISYA_TOKEN_ENCRYPTION_KEY || '').trim();
}

function isConfigured() {
  const value = rawSecret();
  if (!value) return false;
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/g, '') === value.replace(/=+$/g, '')) return true;
  } catch {
    // Continue to passphrase validation.
  }
  return value.length >= 32;
}

function key() {
  const value = rawSecret();
  if (!isConfigured()) {
    const error = new Error('PUBLISYA_TOKEN_ENCRYPTION_KEY doit contenir au minimum 32 caractères ou une clé de 32 octets encodée en hex/base64.');
    error.code = 'PUBLISYA_TOKEN_VAULT_NOT_CONFIGURED';
    throw error;
  }
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/g, '') === value.replace(/=+$/g, '')) return decoded;
  } catch {
    // Fall back to SHA-256 passphrase derivation below.
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function aadBuffer(aad) {
  const normalized = String(aad || '').trim();
  if (!normalized) throw new Error('AAD obligatoire pour chiffrer un jeton Publisya.');
  return Buffer.from(normalized, 'utf8');
}

function encrypt(plaintext, aad) {
  const value = String(plaintext || '');
  if (!value) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadBuffer(aad));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(payload, aad) {
  if (!payload) return null;
  const [version, ivEncoded, tagEncoded, cipherEncoded] = String(payload).split('.');
  if (version !== VERSION || !ivEncoded || !tagEncoded || !cipherEncoded) throw new Error('Format de jeton Publisya invalide.');
  const iv = Buffer.from(ivEncoded, 'base64url');
  const tag = Buffer.from(tagEncoded, 'base64url');
  const ciphertext = Buffer.from(cipherEncoded, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Jeton Publisya corrompu.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aadBuffer(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function stateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function stateHash(state) {
  return crypto.createHash('sha256').update(String(state || ''), 'utf8').digest('hex');
}

function safeFingerprint(payload) {
  return payload ? crypto.createHash('sha256').update(String(payload), 'utf8').digest('hex').slice(0, 12) : null;
}

module.exports = {
  isConfigured,
  encrypt,
  decrypt,
  stateToken,
  stateHash,
  safeFingerprint,
};
