const BILLING_CRON_KEY = process.env.BILLING_CRON_KEY || '';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';
const BILLING_TIMEZONE = process.env.BILLING_TIMEZONE || 'Europe/Brussels';

function localDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function shouldPrepareMonthlyDrafts(date = new Date()) {
  return localDateParts(date).day === '01';
}

async function prepareMonthlyDrafts(port) {
  if (!BILLING_CRON_KEY || !AGENT_KEY) {
    return { skipped: true, reason: 'billing_scheduler_not_configured' };
  }
  if (!shouldPrepareMonthlyDrafts()) {
    return { skipped: true, reason: 'not_first_day' };
  }

  const response = await fetch(`http://127.0.0.1:${port}/api/internal/monthly-billing/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-billing-cron-key': BILLING_CRON_KEY,
      'x-agent-key': AGENT_KEY,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Monthly billing ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : { success: true };
}

function startMonthlyBillingScheduler({ port }) {
  if (!BILLING_CRON_KEY || !AGENT_KEY) {
    console.log('[billing-scheduler] désactivé: BILLING_CRON_KEY ou AGENT_API_KEY absent');
    return null;
  }

  const run = () => prepareMonthlyDrafts(port)
    .then((result) => {
      if (!result?.skipped) console.log('[billing-scheduler] brouillons mensuels préparés');
    })
    .catch((error) => console.error('[billing-scheduler] échec:', error.message));

  const initial = setTimeout(run, 30_000);
  const interval = setInterval(run, 6 * 60 * 60 * 1000);
  interval.unref?.();
  initial.unref?.();
  return { initial, interval };
}

module.exports = { startMonthlyBillingScheduler, prepareMonthlyDrafts, shouldPrepareMonthlyDrafts, localDateParts };