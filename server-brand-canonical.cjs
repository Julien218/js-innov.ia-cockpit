const fs = require('node:fs');
const path = require('node:path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REGISTRY_PATH = path.join(__dirname, 'brand', 'brand-registry.json');
const MAX_TOTAL_TEXT = 120000;

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function host(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return String(value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
}
function loadRegistry() {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); }
  catch (error) { throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: registre ADN canonique indisponible (' + error.message + ').'); }
  if (!Array.isArray(parsed.brands) || parsed.policy?.mode !== 'fail-closed') {
    throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: registre ADN canonique invalide ou non fail-closed.');
  }
  return parsed;
}
function resolveRegistryBrand(brand) {
  const registry = loadRegistry();
  const wantedHost = host(brand?.site_url);
  const slug = norm(brand?.slug);
  const name = norm(brand?.name);
  let match = null;
  if (wantedHost) {
    match = registry.brands.find(item => (item.domains || []).some(domain => host(domain) === wantedHost)) || null;
  }
  if (!match && slug) match = registry.brands.find(item => norm(item.brandId) === slug) || null;
  if (!match && (slug || name)) {
    match = registry.brands.find(item => [item.name, ...(item.aliases || [])].some(alias => [slug, name].includes(norm(alias)))) || null;
  }
  if (!match) throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: marque « ' + (brand?.name || brand?.slug || 'inconnue') + ' » absente du registre ADN canonique.');

  let source = match.source || null;
  if (!source && Array.isArray(match.surfaces)) {
    source = match.surfaces.find(surface => host(surface.domain) === wantedHost) || null;
    if (!source && match.surfaces.length === 1) source = match.surfaces[0];
  }
  if (!source?.repo || !source?.manifest) {
    throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: source canonique non résolue pour ' + match.name + '.');
  }
  return { registry, entry: match, source: { repo: source.repo, ref: source.branch || 'main', manifest: source.manifest } };
}
async function githubFile(repo, ref, filePath) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) throw new Error('Dépôt GitHub canonique invalide.');
  const endpoint = 'https://api.github.com/repos/' + repo + '/contents/' + String(filePath || '').split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(ref || 'main');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'jsinnovia-brand-registry' };
  if (GITHUB_TOKEN) headers.Authorization = 'Bearer ' + GITHUB_TOKEN;
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('GitHub canonique HTTP ' + response.status + ' pour ' + repo + ':' + filePath + '.');
  const data = await response.json();
  if (data.type !== 'file' || data.encoding !== 'base64' || !data.content) throw new Error('Source canonique non textuelle: ' + filePath + '.');
  return {
    path: filePath,
    sha: data.sha || null,
    html_url: data.html_url || null,
    text: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
  };
}
function uniquePaths(manifest, manifestPath) {
  const paths = [];
  const add = value => { if (typeof value === 'string' && value && value !== manifestPath && !paths.includes(value)) paths.push(value); };
  add(manifest?.canonicalSources?.bible);
  add(manifest?.canonicalRules?.machineReadable);
  add(manifest?.canonicalRules?.visualSystemPrompt);
  add(manifest?.canonicalRules?.editorialGuide);
  for (const value of manifest?.agentPolicy?.readOrder || []) add(value);
  return paths.slice(0, 7);
}
async function loadCanonicalBrand(brand) {
  const resolved = resolveRegistryBrand(brand);
  const manifestFile = await githubFile(resolved.source.repo, resolved.source.ref, resolved.source.manifest);
  let manifest;
  try { manifest = JSON.parse(manifestFile.text); }
  catch (_) { throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: manifeste canonique JSON invalide pour ' + resolved.entry.name + '.'); }
  if (manifest?.agentPolicy?.mode !== 'fail-closed' && resolved.registry.policy?.mode === 'fail-closed') {
    throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: manifeste de ' + resolved.entry.name + ' ne confirme pas le mode fail-closed.');
  }

  const docs = [];
  let used = 0;
  for (const filePath of uniquePaths(manifest, resolved.source.manifest)) {
    if (used >= MAX_TOTAL_TEXT) break;
    try {
      const file = await githubFile(resolved.source.repo, resolved.source.ref, filePath);
      file.text = file.text.slice(0, Math.max(0, MAX_TOTAL_TEXT - used));
      used += file.text.length;
      docs.push(file);
    } catch (error) {
      docs.push({ path: filePath, sha: null, text: '', warning: error.message });
    }
  }

  const critical = [];
  if (manifest?.canonicalSources?.bible) critical.push(manifest.canonicalSources.bible);
  if (manifest?.canonicalRules?.machineReadable) critical.push(manifest.canonicalRules.machineReadable);
  for (const requiredPath of critical) {
    const file = docs.find(item => item.path === requiredPath);
    if (!file || !file.text) throw new Error('BLOCK_BRAND_CONTEXT_REQUIRED: source ADN obligatoire inaccessible: ' + requiredPath + '.');
  }

  return {
    source: 'canonical-registry',
    registry_version: resolved.registry.registryVersion || null,
    brand_id: resolved.entry.brandId,
    registry_entry: resolved.entry,
    repository: resolved.source.repo,
    ref: resolved.source.ref,
    manifest_path: resolved.source.manifest,
    manifest_sha: manifestFile.sha,
    manifest,
    documents: docs,
    text: docs.filter(d => d.text).map(d => '### ' + d.path + '\n' + d.text).join('\n\n').slice(0, MAX_TOTAL_TEXT)
  };
}

module.exports = { loadRegistry, resolveRegistryBrand, loadCanonicalBrand, githubFile, norm, host };
