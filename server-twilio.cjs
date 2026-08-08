/**
 * server-twilio.cjs — Module Twilio pour le Cockpit JS-Innov.IA
 *
 * Implémente:
 * 1. GET /api/twilio/account — infos compte (balance, type, status)
 * 2. GET /api/twilio/numbers — numéros téléphoniques
 * 3. POST /api/twilio/sms — envoyer un SMS
 * 4. GET /api/twilio/messages — historique des messages
 * 5. GET /api/twilio/calls — historique des appels
 * 6. GET /api/twilio/usage — usage et coûts
 *
 * Sécurité: TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN côté serveur uniquement
 */

const express = require('express');
const router = express.Router();
const { requireSession } = require('./server-security.cjs');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

function hasTwilioConfig() {
  return TWILIO_SID && TWILIO_TOKEN && TWILIO_SID.startsWith('AC');
}

async function twilioFetch(path, options = {}) {
  if (!hasTwilioConfig()) throw new Error('Twilio non configure. TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN requis.');
  const url = path.startsWith('http') ? path : `${TWILIO_BASE}/${TWILIO_SID}/${path}.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error_message || `HTTP ${res.status}`);
  return data;
}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

// GET /account
router.get('/account', requireSession('admin'), async (req, res) => {
  try {
    if (!hasTwilioConfig()) return res.json({ success: false, configured: false, error: 'Twilio non configure' });
    const [account, balance] = await Promise.all([twilioFetch(''), twilioFetch('Balance')]);
    res.json({
      success: true, configured: true,
      account: { sid: account.sid, friendlyName: account.friendly_name, type: account.type, status: account.status, createdAt: account.date_created },
      balance: { value: parseFloat(balance.balance), currency: balance.currency },
    });
  } catch (err) { console.error('[Twilio] Account:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

// GET /numbers
router.get('/numbers', requireSession('admin'), async (req, res) => {
  try {
    const data = await twilioFetch('IncomingPhoneNumbers', { method: 'GET' });
    const numbers = (data.incoming_phone_numbers || []).map(n => ({
      sid: n.sid, phoneNumber: n.phone_number, friendlyName: n.friendly_name,
      capabilities: n.capabilities, smsUrl: n.sms_url, voiceUrl: n.voice_url, status: n.status, dateCreated: n.date_created,
    }));
    res.json({ success: true, numbers });
  } catch (err) { console.error('[Twilio] Numbers:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

// POST /sms
router.post('/sms', requireSession('admin'), async (req, res) => {
  try {
    const { to, from, body } = req.body;
    if (!to) return res.status(400).json({ success: false, error: 'Destinataire (to) requis' });
    if (!body) return res.status(400).json({ success: false, error: 'Message (body) requis' });
    let fromNumber = from;
    if (!fromNumber) {
      const numbersData = await twilioFetch('IncomingPhoneNumbers', { method: 'GET' });
      const firstNumber = numbersData.incoming_phone_numbers?.[0];
      if (!firstNumber) return res.status(400).json({ success: false, error: 'Aucun numero Twilio disponible' });
      fromNumber = firstNumber.phone_number;
    }
    const result = await twilioFetch('Messages', {
      method: 'POST',
      body: formEncode({ To: to, From: fromNumber, Body: body }),
    });
    res.json({
      success: true,
      message: { sid: result.sid, to: result.to, from: result.from, body: result.body, status: result.status,
        errorCode: result.error_code, errorMessage: result.error_message, dateCreated: result.date_created, dateSent: result.date_sent,
        price: result.price, priceUnit: result.price_unit },
    });
  } catch (err) { console.error('[Twilio] SMS:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

// GET /messages
router.get('/messages', requireSession('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const data = await twilioFetch(`Messages?PageSize=${limit}`, { method: 'GET' });
    const messages = (data.messages || []).map(m => ({
      sid: m.sid, to: m.to, from: m.from, body: m.body, direction: m.direction, status: m.status,
      errorCode: m.error_code, errorMessage: m.error_message, dateCreated: m.date_created, dateSent: m.date_sent,
      price: m.price, priceUnit: m.price_unit, segments: m.num_segments,
    }));
    res.json({ success: true, messages, count: messages.length });
  } catch (err) { console.error('[Twilio] Messages:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

// GET /calls
router.get('/calls', requireSession('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const data = await twilioFetch(`Calls?PageSize=${limit}`, { method: 'GET' });
    const calls = (data.calls || []).map(c => ({
      sid: c.sid, to: c.to, from: c.from, direction: c.direction, status: c.status,
      duration: c.duration, startTime: c.start_time, endTime: c.end_time,
      price: c.price, priceUnit: c.price_unit, fromFormatted: c.from_formatted, toFormatted: c.to_formatted,
    }));
    res.json({ success: true, calls, count: calls.length });
  } catch (err) { console.error('[Twilio] Calls:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

// GET /usage
router.get('/usage', requireSession('admin'), async (req, res) => {
  try {
    const data = await twilioFetch('Usage/Records?Period=this_month', { method: 'GET' });
    const usage = (data.usage_records || []).map(u => ({
      category: u.category, description: u.description, count: u.count, usageUnit: u.usage_unit,
      price: u.price, priceUnit: u.price_unit, currency: u.currency_unit,
    }));
    const totalCost = usage.filter(u => u.price).reduce((sum, u) => sum + parseFloat(u.price), 0);
    res.json({ success: true, usage, totalCost: totalCost.toFixed(2) });
  } catch (err) { console.error('[Twilio] Usage:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
