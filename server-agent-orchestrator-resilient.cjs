const core = require('./server-agent-orchestrator.cjs');

function isRetryableFailure(item) {
  if (!item || item.ok || item.skipped) return false;
  const message = String(item.error || item.reason || '').toLowerCase();
  return /aborted|timeout|timed out|econnreset|etimedout/.test(message);
}

/**
 * Résilience single-agent : un échec réseau ne crée jamais une autre identité.
 * On rejoue une seule fois Elynea avec exactement les mêmes compétences.
 */
async function runReadOnlyDelegations(message) {
  const results = await core.runReadOnlyDelegations(message);
  const resilient = [];

  for (const item of results) {
    if (!isRetryableFailure(item)) {
      resilient.push(item);
      continue;
    }

    const skills = Array.isArray(item.skills) && item.skills.length
      ? item.skills
      : [core.buildVirtualAgent(message)];

    try {
      const retry = await core.delegateElyneaReadOnly(skills, message);
      resilient.push({
        ...retry,
        retry_used: true,
        retry_reason: String(item.error || item.reason || 'timeout Elynea').slice(0, 300),
      });
    } catch (error) {
      resilient.push({
        ...item,
        retry_used: true,
        retry_error: String(error.message || error).slice(0, 500),
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
