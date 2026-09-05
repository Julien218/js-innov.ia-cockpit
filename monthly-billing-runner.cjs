#!/usr/bin/env node
const { runMonthlyBilling } = require('./server-monthly-billing.cjs');

async function main() {
  const month = String(process.env.BILLING_MONTH_OVERRIDE || '').trim() || null;
  const dryRun = /^(1|true|yes)$/i.test(String(process.env.BILLING_DRY_RUN || ''));
  const summary = await runMonthlyBilling({ month, dryRun });
  const safeSummary = {
    month: summary.month,
    clients: summary.clients,
    created: summary.created,
    refreshed: summary.refreshed,
    unchanged: summary.unchanged,
    blocked: summary.blocked,
    skipped: summary.skipped,
    errors: summary.errors,
    dry_run: summary.dry_run,
  };
  console.log(`[MONTHLY BILLING] ${JSON.stringify(safeSummary)}`);
  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[MONTHLY BILLING] échec: ${String(error?.message || error).slice(0, 500)}`);
  process.exitCode = 1;
});
