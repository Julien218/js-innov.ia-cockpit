/**
 * Tests d'autorisation multi-ville.
 * Vérifie qu'un utilisateur de la ville A ne peut pas accéder aux données de la ville B.
 */
import { assertCityAccess, AuthError } from '../src/lib/auth';
import type { AuthContext } from '../src/lib/types';

const CITY_A = '00000000-0000-0000-0000-000000000001';
const CITY_B = '00000000-0000-0000-0000-000000000002';

function makeCtx(cityId: string, role: AuthContext['role'] = 'agent'): AuthContext {
  return { userId: 'user-1', email: 'test@test.com', cityId, role, channel: 'web' };
}

describe('assertCityAccess — multi-ville', () => {
  test('utilisateur ville A bloqué sur ville B', () => {
    expect(() => assertCityAccess(makeCtx(CITY_A), CITY_B)).toThrow(AuthError);
  });

  test('utilisateur ville A autorisé sur ville A', () => {
    expect(() => assertCityAccess(makeCtx(CITY_A), CITY_A)).not.toThrow();
  });

  test('superadmin peut acceder a nimporte quelle ville', () => {
    expect(() => assertCityAccess(makeCtx(CITY_A, 'superadmin'), CITY_B)).not.toThrow();
  });

  test('AuthError retourne le bon status HTTP', () => {
    try { assertCityAccess(makeCtx(CITY_A), CITY_B); } catch(e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).status).toBe(403);
    }
  });
});
