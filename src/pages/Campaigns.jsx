import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Film, Image as ImageIcon, Loader2, Megaphone, Plus, RefreshCw, Settings2, Sparkles, XCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { base44Shim as base44 } from '@/lib/supabaseVideoClient';
import { campaignApi, arrayToCsv, csvToArray, generateCampaignVideo, refreshCampaignVideo } from '@/lib/campaignOrchestrator';

const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const panel = 'rounded-2xl border border-border bg-card p-4 shadow-sm';

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}
function lines(value) { return (Array.isArray(value) ? value : []).join('\n'); }
function splitLines(value) { return String(value || '').split(/\n+/).map(v => v.trim()).filter(Boolean); }

export default function Campaigns() {
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [posts, setPosts] = useState([]);
  const [tab, setTab] = useState('campaigns');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [campaignForm, setCampaignForm] = useState({ name: '', objective: '', phase: 'recrutement', cta: '', landing_url: '', channels: ['facebook','instagram','tiktok'] });
  const [postForm, setPostForm] = useState({ title: '', brief: '', platforms: ['facebook','instagram','tiktok'], video_engine: 'auto' });
  const [brandForm, setBrandForm] = useState({});

  const selectedBrand = useMemo(() => brands.find(b => b.id === brandId), [brands, brandId]);
  const selectedCampaign = useMemo(() => campaigns.find(c => c.id === campaignId), [campaigns, campaignId]);

  const loadBrands = async () => {
    const data = await campaignApi('/brands');
    setBrands(data.brands || []);
    setBrandId(current => current && data.brands.some(b => b.id === current) ? current : data.brands?.[0]?.id || '');
  };
  const loadCampaigns = async (id = brandId) => {
    if (!id) { setCampaigns([]); setCampaignId(''); return; }
    const data = await campaignApi('/?brand_id=' + encodeURIComponent(id));
    setCampaigns(data.campaigns || []);
    setCampaignId(current => current && data.campaigns.some(c => c.id === current) ? current : data.campaigns?.[0]?.id || '');
  };
  const loadPosts = async (id = campaignId) => {
    if (!id) { setPosts([]); return; }
    const data = await campaignApi('/' + encodeURIComponent(id) + '/posts');
    setPosts(data.posts || []);
  };

  useEffect(() => { loadBrands().catch(e => setNotice({ type: 'error', text: e.message })); }, []);
  useEffect(() => { if (brandId) loadCampaigns(brandId).catch(e => setNotice({ type: 'error', text: e.message })); }, [brandId]);
  useEffect(() => { if (campaignId) loadPosts(campaignId).catch(e => setNotice({ type: 'error', text: e.message })); else setPosts([]); }, [campaignId]);
  useEffect(() => {
    if (!selectedBrand) return;
    const rules = parseJson(selectedBrand.visual_rules, {});
    setBrandForm({
      ...selectedBrand,
      seo_keywords_text: arrayToCsv(parseJson(selectedBrand.seo_keywords, [])),
      hashtags_required_text: arrayToCsv(parseJson(selectedBrand.hashtags_required, [])),
      hashtags_recommended_text: arrayToCsv(parseJson(selectedBrand.hashtags_recommended, [])),
      hashtags_forbidden_text: arrayToCsv(parseJson(selectedBrand.hashtags_forbidden, [])),
      must_text: lines(rules.must || []),
      avoid_text: lines(rules.avoid || []),
      palette_text: JSON.stringify(parseJson(selectedBrand.palette, {}), null, 2),
    });
  }, [selectedBrand]);

  const act = async (key, fn) => {
    setBusy(key); setNotice(null);
    try { await fn(); } catch (e) { setNotice({ type: 'error', text: e.message }); }
    finally { setBusy(''); }
  };

  const saveBrand = () => act('brand-save', async () => {
    const payload = {
      ...brandForm,
      seo_keywords: csvToArray(brandForm.seo_keywords_text),
      hashtags_required: csvToArray(brandForm.hashtags_required_text),
      hashtags_recommended: csvToArray(brandForm.hashtags_recommended_text),
      hashtags_forbidden: csvToArray(brandForm.hashtags_forbidden_text),
      visual_rules: { must: splitLines(brandForm.must_text), avoid: splitLines(brandForm.avoid_text) },
      palette: parseJson(brandForm.palette_text, {}),
      fallback_to_api: Boolean(brandForm.fallback_to_api),
    };
    const data = await campaignApi('/brands/' + encodeURIComponent(brandId), { method: 'PATCH', body: JSON.stringify(payload) });
    setBrands(current => current.map(b => b.id === data.brand.id ? data.brand : b));
    setNotice({ type: 'success', text: 'ADN de marque enregistré.' });
  });

  const createCampaign = () => act('campaign-create', async () => {
    if (!brandId || !campaignForm.name.trim()) throw new Error('Choisis une marque et donne un nom à la campagne.');
    const data = await campaignApi('/', { method: 'POST', body: JSON.stringify({ ...campaignForm, brand_id: brandId, status: 'active' }) });
    setCampaigns(current => [data.campaign, ...current]);
    setCampaignId(data.campaign.id);
    setCampaignForm({ name: '', objective: '', phase: 'recrutement', cta: '', landing_url: '', channels: ['facebook','instagram','tiktok'] });
  });

  const createPost = () => act('post-create', async () => {
    if (!campaignId || !postForm.brief.trim()) throw new Error('Ajoute un brief de contenu.');
    const data = await campaignApi('/' + encodeURIComponent(campaignId) + '/posts', { method: 'POST', body: JSON.stringify(postForm) });
    setPosts(current => [data.post, ...current]);
    setPostForm({ title: '', brief: '', platforms: ['facebook','instagram','tiktok'], video_engine: 'auto' });
  });

  const draftPost = post => act('draft-' + post.id, async () => {
    const data = await campaignApi('/posts/' + encodeURIComponent(post.id) + '/draft', { method: 'POST', body: JSON.stringify({ brief: post.brief, platforms: post.platforms }) });
    setPosts(current => current.map(p => p.id === post.id ? data.post : p));
    setNotice({ type: 'success', text: 'Elynea a préparé les textes, SEO, hashtags et prompts.' });
  });

  const generateImage = post => act('image-' + post.id, async () => {
    const compiled = await campaignApi('/posts/' + encodeURIComponent(post.id) + '/compile', { method: 'POST', body: '{}' });
    await campaignApi('/posts/' + encodeURIComponent(post.id), { method: 'PATCH', body: JSON.stringify({ image_status: 'generating', image_prompt: compiled.image_prompt }) });
    const result = await base44.integrations.Core.GenerateImage({ prompt: compiled.image_prompt });
    if (!result?.url) throw new Error('Le générateur n’a retourné aucune image.');
    const updated = await campaignApi('/posts/' + encodeURIComponent(post.id), {
      method: 'PATCH',
      body: JSON.stringify({ image_url: result.url, image_status: 'review', status: 'image_review', image_prompt: compiled.image_prompt, video_prompt: compiled.video_prompt })
    });
    setPosts(current => current.map(p => p.id === post.id ? updated.post : p));
  });

  const approveAndAnimate = post => act('approve-' + post.id, async () => {
    const approved = await campaignApi('/posts/' + encodeURIComponent(post.id) + '/approve-image', { method: 'POST', body: '{}' });
    setPosts(current => current.map(p => p.id === post.id ? approved.post : p));
    try {
      await generateCampaignVideo({ postId: post.id, orchestration: approved.orchestration, allowPaidApi: false });
    } catch (error) {
      if (error.code !== 'PAID_API_CONFIRMATION_REQUIRED') throw error;
      const ok = window.confirm('Le moteur local n’est pas utilisé ou indisponible. Autoriser UNE génération vidéo xAI payante à partir de cette image validée ?');
      if (!ok) {
        setNotice({ type: 'info', text: 'Image validée. La génération vidéo API n’a pas été autorisée.' });
        await loadPosts();
        return;
      }
      await generateCampaignVideo({ postId: post.id, orchestration: approved.orchestration, allowPaidApi: true });
    }
    await loadPosts();
    setNotice({ type: 'success', text: 'Image validée : génération vidéo lancée.' });
  });

  const rejectImage = post => act('reject-' + post.id, async () => {
    const data = await campaignApi('/posts/' + encodeURIComponent(post.id), { method: 'PATCH', body: JSON.stringify({ image_status: 'rejected', status: 'prepared' }) });
    setPosts(current => current.map(p => p.id === post.id ? data.post : p));
  });

  const refreshVideo = post => act('video-' + post.id, async () => {
    await refreshCampaignVideo(post);
    await loadPosts();
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5">
      <PageHeader title="Campagnes" subtitle="Multi-marques · Elynea · ADN GitHub · Image → validation → vidéo" />

      {notice && <div className={'rounded-xl border px-4 py-3 text-sm ' + (notice.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700' : notice.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-blue-500/30 bg-blue-500/10 text-blue-700')}>{notice.text}</div>}

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'campaigns' ? 'default' : 'outline'} onClick={() => setTab('campaigns')}><Megaphone className="w-4 h-4 mr-2" />Campagnes</Button>
        <Button variant={tab === 'brand' ? 'default' : 'outline'} onClick={() => setTab('brand')}><Settings2 className="w-4 h-4 mr-2" />Marque & ADN</Button>
      </div>

      <section className={panel}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">Marque / site
            <select className={input + ' mt-1'} value={brandId} onChange={e => setBrandId(e.target.value)}>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name} — {b.site_url || 'sans site'}</option>)}
            </select>
          </label>
          {tab === 'campaigns' && <label className="text-sm font-medium">Campagne active
            <select className={input + ' mt-1'} value={campaignId} onChange={e => setCampaignId(e.target.value)}>
              <option value="">Créer / sélectionner…</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phase}</option>)}
            </select>
          </label>}
        </div>
      </section>

      {tab === 'brand' && selectedBrand && (
        <section className={panel + ' space-y-4'}>
          <div><h2 className="font-semibold">Bible ADN — {selectedBrand.name}</h2><p className="text-xs text-muted-foreground">La source GitHub est relue avant chaque préparation Elynea et son SHA est enregistré avec le contenu.</p></div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium">Site<input className={input + ' mt-1'} value={brandForm.site_url || ''} onChange={e => setBrandForm(v => ({ ...v, site_url: e.target.value }))} /></label>
            <label className="text-xs font-medium">Skill Elynea<input className={input + ' mt-1'} value={brandForm.skill_key || ''} onChange={e => setBrandForm(v => ({ ...v, skill_key: e.target.value }))} /></label>
            <label className="text-xs font-medium">Dépôt GitHub Bible ADN<input className={input + ' mt-1'} placeholder="Julien218/mon-repo" value={brandForm.github_repository || ''} onChange={e => setBrandForm(v => ({ ...v, github_repository: e.target.value }))} /></label>
            <label className="text-xs font-medium">Fichier Bible ADN<input className={input + ' mt-1'} placeholder="docs/BRAND_BIBLE.md" value={brandForm.github_path || ''} onChange={e => setBrandForm(v => ({ ...v, github_path: e.target.value }))} /></label>
            <label className="text-xs font-medium">Branche / ref<input className={input + ' mt-1'} value={brandForm.github_ref || 'main'} onChange={e => setBrandForm(v => ({ ...v, github_ref: e.target.value }))} /></label>
            <label className="text-xs font-medium">Planche ADN (URL)<input className={input + ' mt-1'} value={brandForm.brand_board_url || ''} onChange={e => setBrandForm(v => ({ ...v, brand_board_url: e.target.value }))} /></label>
            <label className="text-xs font-medium md:col-span-2">Ton<textarea className={input + ' mt-1 min-h-20'} value={brandForm.tone || ''} onChange={e => setBrandForm(v => ({ ...v, tone: e.target.value }))} /></label>
            <label className="text-xs font-medium">Règles obligatoires<textarea className={input + ' mt-1 min-h-28'} value={brandForm.must_text || ''} onChange={e => setBrandForm(v => ({ ...v, must_text: e.target.value }))} /></label>
            <label className="text-xs font-medium">À éviter / interdits<textarea className={input + ' mt-1 min-h-28'} value={brandForm.avoid_text || ''} onChange={e => setBrandForm(v => ({ ...v, avoid_text: e.target.value }))} /></label>
            <label className="text-xs font-medium">Mots-clés SEO<input className={input + ' mt-1'} value={brandForm.seo_keywords_text || ''} onChange={e => setBrandForm(v => ({ ...v, seo_keywords_text: e.target.value }))} /></label>
            <label className="text-xs font-medium"># obligatoires<input className={input + ' mt-1'} value={brandForm.hashtags_required_text || ''} onChange={e => setBrandForm(v => ({ ...v, hashtags_required_text: e.target.value }))} /></label>
            <label className="text-xs font-medium"># recommandés<input className={input + ' mt-1'} value={brandForm.hashtags_recommended_text || ''} onChange={e => setBrandForm(v => ({ ...v, hashtags_recommended_text: e.target.value }))} /></label>
            <label className="text-xs font-medium"># interdits<input className={input + ' mt-1'} value={brandForm.hashtags_forbidden_text || ''} onChange={e => setBrandForm(v => ({ ...v, hashtags_forbidden_text: e.target.value }))} /></label>
            <label className="text-xs font-medium">Moteur vidéo
              <select className={input + ' mt-1'} value={brandForm.video_engine || 'auto'} onChange={e => setBrandForm(v => ({ ...v, video_engine: e.target.value }))}>
                <option value="auto">AUTO — local prioritaire</option><option value="local">LOCAL uniquement</option><option value="api">API xAI</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={Boolean(brandForm.fallback_to_api)} onChange={e => setBrandForm(v => ({ ...v, fallback_to_api: e.target.checked }))} /> Autoriser le fallback API après confirmation payante</label>
          </div>
          <Button onClick={saveBrand} disabled={busy === 'brand-save'}>{busy === 'brand-save' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Enregistrer l’ADN</Button>
        </section>
      )}

      {tab === 'campaigns' && (
        <>
          <section className={panel + ' space-y-3'}>
            <div className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /><h2 className="font-semibold">Nouvelle campagne</h2></div>
            <div className="grid gap-3 md:grid-cols-2">
              <input className={input} placeholder="Ex. Recrutement Miss & Mister Dour 2027" value={campaignForm.name} onChange={e => setCampaignForm(v => ({ ...v, name: e.target.value }))} />
              <input className={input} placeholder="Phase : recrutement, lancement, teasing…" value={campaignForm.phase} onChange={e => setCampaignForm(v => ({ ...v, phase: e.target.value }))} />
              <textarea className={input + ' min-h-20 md:col-span-2'} placeholder="Objectif de la campagne" value={campaignForm.objective} onChange={e => setCampaignForm(v => ({ ...v, objective: e.target.value }))} />
              <input className={input} placeholder="CTA principal" value={campaignForm.cta} onChange={e => setCampaignForm(v => ({ ...v, cta: e.target.value }))} />
              <input className={input} placeholder="Landing page / formulaire" value={campaignForm.landing_url} onChange={e => setCampaignForm(v => ({ ...v, landing_url: e.target.value }))} />
            </div>
            <Button onClick={createCampaign} disabled={busy === 'campaign-create'}>Créer la campagne</Button>
          </section>

          {selectedCampaign && (
            <section className={panel + ' space-y-3'}>
              <div><p className="text-xs uppercase text-muted-foreground">{selectedBrand?.name}</p><h2 className="font-semibold">{selectedCampaign.name}</h2><p className="text-sm text-muted-foreground">{selectedCampaign.objective}</p></div>
              <textarea className={input + ' min-h-28'} placeholder="Ex. Prépare un post d’ouverture du recrutement 2027 avec suspense, CTA inscription et visuel vertical premium." value={postForm.brief} onChange={e => setPostForm(v => ({ ...v, brief: e.target.value }))} />
              <div className="flex flex-wrap items-center gap-4">
                {['facebook','instagram','tiktok'].map(platform => <label key={platform} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={postForm.platforms.includes(platform)} onChange={e => setPostForm(v => ({ ...v, platforms: e.target.checked ? [...v.platforms, platform] : v.platforms.filter(p => p !== platform) }))} />{platform}</label>)}
                <select className={input + ' max-w-52'} value={postForm.video_engine} onChange={e => setPostForm(v => ({ ...v, video_engine: e.target.value }))}><option value="auto">Vidéo AUTO</option><option value="local">Vidéo LOCAL</option><option value="api">Vidéo API</option></select>
              </div>
              <Button onClick={createPost} disabled={busy === 'post-create'}><Plus className="w-4 h-4 mr-2" />Créer le contenu</Button>
            </section>
          )}

          <div className="space-y-4">
            {posts.map(post => (
              <article key={post.id} className={panel + ' space-y-4'}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{post.status}</span><span>·</span><span>{(post.platforms || []).join(' · ')}</span>{post.adn_source?.sha && <><span>·</span><span>ADN {post.adn_source.sha.slice(0, 8)}</span></>}</div>
                    <h3 className="font-semibold mt-1">{post.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{post.brief}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => draftPost(post)} disabled={busy === 'draft-' + post.id}>{busy === 'draft-' + post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Elynea</Button>
                    <Button size="sm" variant="outline" onClick={() => generateImage(post)} disabled={busy === 'image-' + post.id}><ImageIcon className="w-3.5 h-3.5" /> {post.image_url ? 'Régénérer image' : 'Générer image'}</Button>
                  </div>
                </div>

                {(post.copy?.facebook || post.copy?.instagram || post.copy?.tiktok?.caption) && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Textes & référencement</summary><div className="grid gap-3 lg:grid-cols-3 mt-3 text-xs"><div><strong>Facebook</strong><p className="whitespace-pre-wrap mt-1 text-muted-foreground">{post.copy?.facebook}</p><p className="mt-2 text-primary">{(post.hashtags?.facebook || []).join(' ')}</p></div><div><strong>Instagram</strong><p className="whitespace-pre-wrap mt-1 text-muted-foreground">{post.copy?.instagram}</p><p className="mt-2 text-primary">{(post.hashtags?.instagram || []).join(' ')}</p></div><div><strong>TikTok</strong><p className="mt-1">{post.copy?.tiktok?.hook}</p><p className="whitespace-pre-wrap mt-1 text-muted-foreground">{post.copy?.tiktok?.caption}</p><p className="mt-2 text-primary">{(post.hashtags?.tiktok || []).join(' ')}</p></div></div></details>}

                {post.image_url && <div className="grid gap-4 lg:grid-cols-[minmax(0,460px)_1fr]"><img src={post.image_url} alt={post.seo?.alt_text || post.title} className="w-full max-h-[520px] object-contain rounded-xl border bg-black/5" /><div className="space-y-3"><div className="rounded-xl border p-3 text-xs"><strong>Image</strong><p className="mt-1 text-muted-foreground">{post.image_status}</p></div>{post.image_status === 'review' && <div className="flex flex-wrap gap-2"><Button onClick={() => approveAndAnimate(post)} disabled={busy === 'approve-' + post.id}><CheckCircle2 className="w-4 h-4 mr-2" />Valider + générer vidéo</Button><Button variant="outline" onClick={() => rejectImage(post)}><XCircle className="w-4 h-4 mr-2" />Refuser</Button></div>}<details className="rounded-xl border p-3"><summary className="cursor-pointer text-xs font-medium">Prompts ADN</summary><p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{post.image_prompt}</p><hr className="my-3 border-border" /><p className="text-xs whitespace-pre-wrap text-muted-foreground">{post.video_prompt}</p></details></div></div>}

                {post.video_job_id && <div className="rounded-xl border border-border p-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Film className="w-4 h-4 text-primary" /><div><p className="text-sm font-medium">Vidéo · {post.video_provider}</p><p className="text-xs text-muted-foreground">{post.video_status} · {post.video_job_id}</p></div></div><Button size="sm" variant="outline" onClick={() => refreshVideo(post)} disabled={busy === 'video-' + post.id}><RefreshCw className={'w-3.5 h-3.5 mr-2 ' + (busy === 'video-' + post.id ? 'animate-spin' : '')} />Actualiser</Button>{post.video_url && <video controls src={post.video_url} className="w-full max-h-[420px] rounded-lg bg-black" />}</div>}
              </article>
            ))}
            {campaignId && posts.length === 0 && <div className={panel + ' text-center text-sm text-muted-foreground py-10'}>Aucun contenu pour cette campagne.</div>}
          </div>
        </>
      )}
    </div>
  );
}
