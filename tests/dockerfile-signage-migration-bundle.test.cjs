const fs = require('fs');
const path = require('path');

// Test that the Dockerfile correctly bundles the signage migration script
describe('Dockerfile Signage Migration Bundle', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const dockerfilePath = path.join(repoRoot, 'Dockerfile');

  it('should have COPY directive for /app/scripts', () => {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
    const hasCopyScripts = dockerfileContent.includes('COPY --from=builder /app/scripts ./scripts');
    expect(hasCopyScripts).toBe(true);
  });

  it('should include migrate-signage-dropbox-20260903.cjs in Dockerfile build checks', () => {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
    const hasScriptCheck = dockerfileContent.includes('test -f /app/scripts/migrate-signage-dropbox-20260903.cjs');
    expect(hasScriptCheck).toBe(true);
  });

  it('should have the migration script file in /scripts', () => {
    const scriptPath = path.join(repoRoot, 'scripts', 'migrate-signage-dropbox-20260903.cjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('should not execute the migration script during build (test only)', () => {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
    // Ensure the migration script is checked for existence but not executed
    const hasTestCheck = dockerfileContent.includes('test -f /app/scripts/migrate-signage-dropbox-20260903.cjs');
    // Verify there's no RUN command that directly executes the migration
    const doesNotRunScriptDirectly = !dockerfileContent.includes('node /app/scripts/migrate-signage-dropbox-20260903.cjs');
    expect(hasTestCheck).toBe(true);
    expect(doesNotRunScriptDirectly).toBe(true);
  });
});

