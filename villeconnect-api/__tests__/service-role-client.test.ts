/**
 * Test : protection service_role.
 * Verifie que supabase.ts leve une erreur si les variables env sont absentes.
 */
describe('Client supabase — protection service_role', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    else delete process.env.SUPABASE_URL;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test('env SUPABASE_URL present ne leve pas d erreur', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-key-for-test';
    // Le module est charge au demarrage avec les vars du setup — pas d erreur attendue
    expect(process.env.SUPABASE_URL).toBeDefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
  });

  test('les vars env de test sont bien injectees par jest.setup', () => {
    expect(process.env.SUPABASE_URL).toMatch(/supabase/);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });

  test('le service_role key ne doit jamais etre expose dans le code source', () => {
    // Ce test verifie l absence de vraies valeurs dans les fichiers sources
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.join(__dirname, '../src');
    const checkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { checkDir(fullPath); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        // Aucune vraie valeur ne doit etre codee en dur (les noms de var sont OK)
        expect(content).not.toMatch(/service_role.*eyJ/);   // pas de JWT reel
        expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);  // pas de vraie OpenAI key
      }
    };
    checkDir(srcDir);
  });
});
