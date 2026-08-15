const express = require('express');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const { ensureClientInvitation } = require('./server-client-onboarding.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const COMMERCE_BRIDGE_KEY = process.env.COMMERCE_BRIDGE_KEY || '';
const ALLOWED_PACKAGES = new Set(['signage', 'signage-surveillance']);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase commerce non configuré');
}

function requireBridge(req, res, next) {
  const key = String(req.headers['x-commerce-key'] || '');
  if (!COMMERCE_BRIDGE_KEY || !key || key !== COMMERCE_BRIDGE_KEY) {
    return res.status(401).json({ error: 'Passerelle commerce non autorisée' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

async function supabase(resource, options = {}) {
  if (process.env.DATABASE_URL) return postgresRest(resource, options);
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase commerce HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

async function getOrderById(id) {
  const rows = await supabase(`commerce_orders?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getOrderBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const rows = await supabase(`commerce_orders?select=*&stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateOrder(id, patch) {
  const rows = await supabase(`commerce_orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertEntitlement({ email, moduleCode, orderId, enabled }) {
  const payload = {
    email: String(email || '').toLowerCase(),
    module_code: moduleCode,
    enabled: Boolean(enabled),
    source_order_id: orderId || null,
    updated_at: new Date().toISOString(),
  };
  await supabase('client_module_entitlements?on_conflict=email,module_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  }).catch(async () => {
    const existing = await supabase(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(payload.email)}&module_code=eq.${encodeURIComponent(moduleCode)}&limit=1`);
    const row = Array.isArray(existing) ? existing[0] : null;
    if (row?.id) {
      await supabase(`client_module_entitlements?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
      return;
    }
    await supabase('client_module_entitlements', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...payload, activated_at: new Date().toISOString() }),
    });
  });
}

async function upsertPilotEntitlement({ email, moduleCode, billingAccount }) {
  const now = new Date().toISOString();
  const payload = {
    email: String(email || '').trim().toLowerCase(),
    module_code: moduleCode,
    enabled: true,
    source_order_id: null,
    grant_reason: 'pilot_gift',
    recurring_fee_cents: 0,
    usage_billing_account: String(billingAccount || '').trim(),
    usage_billing_enabled: true,
    updated_at: now,
  };
  await supabase('client_module_entitlements?on_conflict=email,module_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...payload, activated_at: now }),
  });
}

async function setOrderEntitlements(order, enabled = true) {
  if (!order?.email) return;
  await upsertEntitlement({ email: order.email, moduleCode: 'digital_signage', orderId: order.id, enabled });
  if (order.package_id === 'signage-surveillance') {
    await upsertEntitlement({ email: order.email, moduleCode: 'videosurveillance', orderId: order.id, enabled });
  }
}

async function ensureTask(orderId, taskCode, title, days = 2) {
  const due = new Date(Date.now() + days * 86400000).toISOString();
  await supabase('commerce_onboarding_tasks?on_conflict=order_id,task_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ order_id: orderId, task_code: taskCode, title, due_at: due }),
  });
}

async function createOnboarding(order) {
  if (!order) return;
  const tasks = [
    ['audit_installation', 'Vérifier les photos, le contrôleur LED, les entrées HDMI/USB/Ethernet et la connectivité Internet', 1],
    ['player_config', 'Préparer et configurer le Player JS-Innov.IA avec cache local et lancement automatique', 2],
    ['dropbox', 'Créer ou vérifier l’arborescence Dropbox client et les droits d’accès', 2],
    ['signage_config', 'Configurer l’écran, la résolution, les playlists et le premier planning de diffusion', 3],
    ['acceptance_test', 'Effectuer le test de diffusion, le rollback et la validation client', 4],
  ];
  if (order.package_id === 'signage-surveillance') {
    tasks.splice(3, 0, ['camera_audit', 'Identifier les caméras, vérifier RTSP/ONVIF et définir la politique de conservation', 2]);
    tasks.splice(4, 0, ['camera_gateway', 'Configurer la passerelle sécurisée de vidéosurveillance et les enregistrements', 3]);
  }
  for (const [code, title, days] of tasks) await ensureTask(order.id, code, title, days);
}

async function provisionPaidOrder(order) {
  await setOrderEntitlements(order, true);
  await createOnboarding(order);
  await ensureClientInvitation({ email: order.email, fullName: order.contact_name, organisation: order.company });
}

function normalizeOrderPayload(input) {
  const q = input?.questionnaire || {};
  const packageId = String(q.packageId || '');
  if (!ALLOWED_PACKAGES.has(packageId)) throw new Error('Package non autorisé');
  for (const key of ['company', 'contactName', 'email', 'phone', 'installationAddress']) {
    if (!String(q[key] || '').trim()) throw new Error(`Questionnaire incomplet : ${key}`);
  }
  return {
    source: String(input.source || 'jsinnovia-site').slice(0, 80),
    status: 'intake',
    package_id: packageId,
    company: String(q.company).trim().slice(0, 160),
    vat_number: String(q.vatNumber || '').trim().slice(0, 60) || null,
    contact_name: String(q.contactName).trim().slice(0, 160),
    email: String(q.email).trim().toLowerCase().slice(0, 254),
    phone: String(q.phone).trim().slice(0, 60),
    installation_address: String(q.installationAddress).trim().slice(0, 300),
    questionnaire: q,
  };
}

router.post('/intake', requireBridge, async (req, res) => {
  try {
    const payload = normalizeOrderPayload(req.body || {});
    const rows = await supabase('commerce_orders', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order?.id) throw new Error('Commande non créée');
    res.status(201).json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('[commerce] intake:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post('/checkout-created', requireBridge, async (req, res) => {
  try {
    const { orderId, checkoutSessionId, packageId } = req.body || {};
    if (!orderId || !checkoutSessionId) return res.status(400).json({ error: 'orderId et checkoutSessionId requis' });
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (packageId && packageId !== order.package_id) return res.status(409).json({ error: 'Package incohérent' });
    await updateOrder(orderId, { status: 'checkout_created', stripe_checkout_session_id: String(checkoutSessionId) });
    res.json({ success: true });
  } catch (error) {
    console.error('[commerce] checkout-created:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post('/stripe-event', requireBridge, async (req, res) => {
  let trackedEventId = '';
  try {
    const { eventId, eventType, created, livemode, object } = req.body || {};
    if (!eventId || !eventType || !object) return res.status(400).json({ error: 'Événement incomplet' });

    trackedEventId = String(eventId);
    const existing = await supabase(`commerce_events?select=event_id,processing_status,processing_attempts&event_id=eq.${encodeURIComponent(eventId)}&limit=1`);
    if (existing?.[0]?.processing_status === 'processed') return res.json({ success: true, duplicate: true });
    if (existing?.[0]) {
      await supabase(`commerce_events?event_id=eq.${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify({ processing_status: 'processing', processing_error: null, processing_attempts: Number(existing[0].processing_attempts || 0) + 1 }) });
    } else {
      await supabase('commerce_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ event_id: trackedEventId, event_type: String(eventType), livemode: Boolean(livemode), stripe_created_at: created ? new Date(Number(created) * 1000).toISOString() : null, payload: object, processed_at: null, processing_status: 'processing', processing_attempts: 1 }),
      });
    }

    let orderId = object.client_reference_id || object.metadata?.commerce_order_id || null;
    let order = orderId ? await getOrderById(orderId) : null;
    if (!order && object.subscription) order = await getOrderBySubscription(String(object.subscription));
    if (!order && object.id && String(object.object || '') === 'subscription') order = await getOrderBySubscription(String(object.id));

    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(eventType) && order) {
      const paid = eventType === 'checkout.session.async_payment_succeeded' || object.payment_status === 'paid' || object.payment_status === 'no_payment_required';
      order = await updateOrder(order.id, {
        status: paid ? 'paid' : 'checkout_complete',
        stripe_checkout_session_id: object.id || order.stripe_checkout_session_id,
        stripe_customer_id: typeof object.customer === 'string' ? object.customer : object.customer?.id || null,
        stripe_subscription_id: typeof object.subscription === 'string' ? object.subscription : object.subscription?.id || null,
        last_stripe_event_type: eventType,
        ...(paid ? { paid_at: new Date().toISOString() } : {}),
      });
      if (paid) await provisionPaidOrder(order);
    } else if (eventType === 'checkout.session.async_payment_failed' && order) {
      await updateOrder(order.id, { status: 'payment_failed', last_stripe_event_type: eventType });
    } else if (eventType === 'invoice.paid' && order) {
      order = await updateOrder(order.id, { status: 'active', last_stripe_event_type: eventType, paid_at: order.paid_at || new Date().toISOString() });
      await provisionPaidOrder(order);
    } else if (eventType === 'invoice.payment_failed' && order) {
      await updateOrder(order.id, { status: 'payment_attention', last_stripe_event_type: eventType });
    } else if (eventType === 'customer.subscription.updated' && order) {
      const enabled = ACTIVE_SUBSCRIPTION_STATUSES.has(String(object.status || ''));
      order = await updateOrder(order.id, { status: enabled ? 'active' : String(object.status || 'subscription_updated'), last_stripe_event_type: eventType });
      await setOrderEntitlements(order, enabled);
    } else if (eventType === 'customer.subscription.deleted' && order) {
      order = await updateOrder(order.id, { status: 'cancelled', last_stripe_event_type: eventType });
      await setOrderEntitlements(order, false);
    } else if (eventType === 'charge.refunded' && order) {
      await updateOrder(order.id, { status: 'refunded', last_stripe_event_type: eventType });
    }

    await supabase(`commerce_events?event_id=eq.${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify({ processing_status: 'processed', processing_error: null, processed_at: new Date().toISOString() }) });
    res.json({ success: true, orderId: order?.id || null });
  } catch (error) {
    console.error('[commerce] stripe-event:', error.message);
    if (trackedEventId) await supabase(`commerce_events?event_id=eq.${encodeURIComponent(trackedEventId)}`, { method: 'PATCH', body: JSON.stringify({ processing_status: 'failed', processing_error: String(error.message || 'Erreur').slice(0, 300), processed_at: null }) }).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', requireSession('client'), async (req, res) => {
  try {
    const email = String(req.user?.email || '').toLowerCase();
    const entitlements = await supabase(`client_module_entitlements?select=module_code,enabled,source_order_id,updated_at&email=eq.${encodeURIComponent(email)}&order=module_code.asc`);
    const orders = await supabase(`commerce_orders?select=id,status,package_id,company,installation_address,stripe_customer_id,stripe_subscription_id,created_at,updated_at&email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=20`);
    res.json({ success: true, entitlements: Array.isArray(entitlements) ? entitlements : [], orders: Array.isArray(orders) ? orders : [] });
  } catch (error) {
    console.error('[commerce] me:', error.message);
    res.status(503).json({ error: 'Commerce indisponible' });
  }
});

router.get('/orders', requireSession('admin'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const orders = await supabase(`commerce_orders?select=*&order=created_at.desc&limit=${limit}`);
    res.json({ success: true, orders: Array.isArray(orders) ? orders : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/pilot-grant', requireSession('admin'), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const billingAccount = String(req.body?.usageBillingAccount || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email pilote invalide' });
    if (!billingAccount) return res.status(400).json({ error: 'Compte payeur requis' });
    for (const moduleCode of ['digital_signage', 'videosurveillance']) {
      await upsertPilotEntitlement({ email, moduleCode, billingAccount });
    }
    res.status(201).json({
      success: true,
      email,
      modules: ['digital_signage', 'videosurveillance'],
      recurringFeeCents: 0,
      usageBillingAccount: billingAccount,
    });
  } catch (error) {
    console.error('[commerce] pilot-grant:', error.message);
    res.status(500).json({ error: 'Activation pilote impossible' });
  }
});

router.get('/orders/:id/tasks', requireSession('admin'), async (req, res) => {
  try {
    const tasks = await supabase(`commerce_onboarding_tasks?select=*&order_id=eq.${encodeURIComponent(req.params.id)}&order=created_at.asc`);
    res.json({ success: true, tasks: Array.isArray(tasks) ? tasks : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

module.exports = router;

