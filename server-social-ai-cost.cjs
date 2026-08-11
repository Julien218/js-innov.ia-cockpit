const { recordUsage } = require('./server-ai-cost.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function updateItemCost(itemId, costUsd) {
  if (!itemId || !SUPABASE_URL || !SUPABASE_SECRET) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_content_items?id=eq.${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ generation_cost_usd: Number(costUsd || 0) }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`social_content_items cost patch ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
}

function socialAICostMiddleware(req, res, next) {
  const isGenerate = req.method === 'POST' && /^\/items\/[^/]+\/generate\/?$/.test(req.path);
  if (!isGenerate) return next();

  const originalJson = res.json.bind(res);
  res.json = function patchedJson(payload) {
    const send = () => originalJson(payload);
    if (res.statusCode >= 400 || !payload?.item) return send();

    const item = payload.item;
    const usage = item.metadata?.openai_usage;
    if (!usage || !item.generation_model) return send();

    const raw = {
      provider: item.generation_provider || 'openai',
      model: item.generation_model,
      input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      cached_input_tokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
      output_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      project_key: 'social-content-agent',
      project_name: 'Agent Réseaux IA',
      client_key: item.client_id || null,
      client_name: item.client_id || null,
      source: 'social-content-agent',
      request_id: `social-content:${item.id}:v${item.version || 1}`,
      metadata: {
        content_id: item.id,
        profile_id: item.profile_id,
        editorial_series: item.editorial_series || null,
        topic: item.topic || null,
        version: item.version || 1,
      },
    };

    // La réponse utilisateur ne doit pas échouer si le registre de coûts est temporairement indisponible.
    recordUsage(raw, req.user?.email || 'social-content-agent')
      .then(record => updateItemCost(item.id, record?.cost_usd || 0))
      .catch(error => console.error('[social-agent][ai-cost] usage non enregistré:', error.message));

    return send();
  };

  next();
}

module.exports = { socialAICostMiddleware, _test: { updateItemCost } };
