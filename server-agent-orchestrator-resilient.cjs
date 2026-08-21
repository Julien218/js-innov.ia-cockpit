const core = require('./server-agent-orchestrator.cjs');

function isRetryableFailure(item) {
  if (!item || item.ok || item.skipped) return false;
  const message = String(item.error || item.reason || '').toLowerCase();
  return /aborted|timeout|timed out|econnreset|etimedout/.test(message);
}

async function runReadOnlyDelegations(message) {
  const results = await core.runReadOnlyDelegations(message);
  const resilient = [];

  for (const item of results) {
    if (!isRetryableFailure(item)) {
      resilient.push(item);
      continue;
    }

    const originalAgent = item.agent;
    const fallbackAgent = core.buildVirtualAgent(message, originalAgent);
    try {
      const fallback = await core.delegateVirtualReadOnly(fallbackAgent, message);
      resilient.push({
        ...fallback,
        fallback_used: true,
        fallback_reason: String(item.error || item.reason || 'Base44 timeout').slice(0, 300),
        original_agent: originalAgent,
      });
    } catch (error) {
      resilient.push({
        ...item,
        fallback_used: true,
        fallback_error: String(error.message || error).slice(0, 500),
      });
    }
  }

  return resilient;
}

module.exports = {
  ...core,
  runReadOnlyDelegations,
  isRetryableFailure,
};
