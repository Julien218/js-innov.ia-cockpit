const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();

async function postRun(payload) {
  if (!JS_AGENT_KEY) return { ok: false, skipped: true, reason: 'agent_key_missing' };
  try {
    const response = await fetch(`${JS_AGENT_URL}/agent-runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': JS_AGENT_KEY,
        'x-organisation-id': 'jsinnovia',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, skipped: false, error: data?.error || `HTTP ${response.status}` };
    return { ok: true, id: data?.id || null };
  } catch (error) {
    return { ok: false, skipped: false, error: String(error.message || error).slice(0, 300) };
  }
}

async function logDelegationResults(message, results = []) {
  if (!Array.isArray(results) || !results.length) return [];
  const now = new Date().toISOString();
  const logs = [];
  for (const item of results) {
    const agent = item?.agent || {};
    const status = item?.ok ? 'completed' : item?.skipped ? 'skipped' : 'failed';
    const providerName = item?.provider || agent?.provider || 'unknown';
    logs.push(await postRun({
      task_id: null,
      agent_id: String(agent?.key || agent?.provider_agent_id || agent?.role || 'business-agent').slice(0, 160),
      functional_role: String(agent?.role || 'unknown').slice(0, 120),
      provider_agent_id: agent?.provider_agent_id ? String(agent.provider_agent_id).slice(0, 180) : null,
      provider_name: String(providerName).slice(0, 80),
      status,
      execution_mode: 'read_only',
      input: {
        message_excerpt: String(message || '').slice(0, 1500),
        delegated_by: 'companion',
      },
      result: item?.ok ? {
        content_excerpt: String(item.content || '').slice(0, 4000),
        conversation_id: item.conversation_id || null,
        session_id: item.session_id || null,
      } : null,
      error: item?.ok ? null : String(item?.error || item?.reason || 'delegation_failed').slice(0, 500),
      requested_by: 'companion-owner',
      base44_agent_id: providerName === 'base44' ? String(agent?.provider_agent_id || '').slice(0, 180) || null : null,
      base44_conv_id: item?.conversation_id ? String(item.conversation_id).slice(0, 180) : null,
      started_at: now,
      completed_at: now,
    }));
  }
  return logs;
}

module.exports = { logDelegationResults };
