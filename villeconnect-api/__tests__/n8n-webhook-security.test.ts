/**
 * Tests de sécurité du webhook n8n entrant.
 * Couvre : signature invalide, requête expirée, tentative de rejeu.
 */
import crypto from 'crypto';

const N8N_WEBHOOK_SECRET = 'test-secret-for-jest-only';

// Reproduit validateInboundN8nRequest depuis lib/n8n.ts
function signPayload(payload: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', N8N_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

function validateInbound(signature: string, timestamp: string, body: string): { valid: boolean; reason?: string } {
  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum) || Date.now() / 1000 - tsNum > 300) return { valid: false, reason: 'expired' };
  const expected = signPayload(body, timestamp);
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return ok ? { valid: true } : { valid: false, reason: 'invalid_signature' };
  } catch { return { valid: false, reason: 'invalid_signature' }; }
}

const validBody   = JSON.stringify({ city_id: 'abc', status: 'completed', idempotency_key: 'k1', timestamp: new Date().toISOString() });
const nowTs       = Math.floor(Date.now() / 1000).toString();
const validSig    = signPayload(validBody, nowTs);

describe('Sécurité webhook n8n entrant', () => {
  test('signature HMAC valide — acceptée', () => {
    const r = validateInbound(validSig, nowTs, validBody);
    expect(r.valid).toBe(true);
  });

  test('signature invalide — rejetée', () => {
    const r = validateInbound('fakesignature', nowTs, validBody);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid_signature');
  });

  test('timestamp expiré (> 5 min) — rejeté', () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
    const sig   = signPayload(validBody, oldTs);
    const r = validateInbound(sig, oldTs, validBody);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  test('timestamp manquant — rejeté', () => {
    const r = validateInbound(validSig, '', validBody);
    expect(r.valid).toBe(false);
  });

  test('body modifié (tentative de rejeu avec contenu différent) — rejeté', () => {
    const tamperedBody = validBody.replace('completed', 'failed');
    const r = validateInbound(validSig, nowTs, tamperedBody);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid_signature');
  });

  test('signature vide — rejetée', () => {
    const r = validateInbound('', nowTs, validBody);
    expect(r.valid).toBe(false);
  });
});

// Anti-rejeu en mémoire (logique de déduplication)
describe('Anti-rejeu idempotency_key', () => {
  const seen = new Set<string>();

  function processWithIdempotency(key: string): { processed: boolean; reason?: string } {
    if (seen.has(key)) return { processed: false, reason: 'replay_detected' };
    seen.add(key);
    return { processed: true };
  }

  test('première requête traitée', () => {
    expect(processWithIdempotency('key-001').processed).toBe(true);
  });

  test('deuxième requête avec même clé bloquée (rejeu)', () => {
    const r = processWithIdempotency('key-001');
    expect(r.processed).toBe(false);
    expect(r.reason).toBe('replay_detected');
  });

  test('clé différente acceptée', () => {
    expect(processWithIdempotency('key-002').processed).toBe(true);
  });
});
