// Ucademy CAPI transport - shared by the lead, booking and downstream senders.
// Dataset "Ucademy On Demand". Do not point this at a new dataset without
// agreeing it first; that dataset carries the accumulated learning history.

import crypto from 'node:crypto';

const CAPI_VERSION = 'v20.0';

export const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

export const normEmail = (v = '') => String(v).trim().toLowerCase();

export const normName = (v = '') => String(v).trim().toLowerCase().replace(/[^a-z\u00C0-\u024F]/g, '');

// E.164 digits, no plus. Meta's expected format.
export function normPhone(raw = '', region = 'UK') {
  const d = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^44\d{9,10}$/.test(d)) return d;
  if (/^971\d{8,9}$/.test(d)) return d;
  if (/^0\d{9,10}$/.test(d)) return region === 'UAE' ? '971' + d.slice(1) : '44' + d.slice(1);
  if (/^\d{9,10}$/.test(d)) return (region === 'UAE' ? '971' : '44') + d;
  return null;
}

// Match quality is the single biggest determinant of whether this works.
// Send every identifier available, every time.
export function buildUserData(lead, ctx = {}) {
  const phone = normPhone(lead.phone, lead.region);
  const ud = {
    em: lead.email ? [sha256(normEmail(lead.email))] : undefined,
    ph: phone ? [sha256(phone)] : undefined,
    fn: lead.first_name ? [sha256(normName(lead.first_name))] : undefined,
    ln: lead.last_name ? [sha256(normName(lead.last_name))] : undefined,
    country: lead.region === 'UAE' ? [sha256('ae')] : lead.region === 'UK' ? [sha256('gb')] : undefined,
    external_id: lead.lead_id ? [sha256(lead.lead_id)] : undefined,
    fbp: lead.fbp || undefined,
    fbc: lead.fbc || undefined,
    client_ip_address: ctx.ip || lead.client_ip || undefined,
    client_user_agent: ctx.ua || lead.client_user_agent || undefined,
  };
  Object.keys(ud).forEach((k) => ud[k] === undefined && delete ud[k]);
  return ud;
}

// events: [{ event_name, event_time, event_id, event_source_url, action_source,
//            user_data, custom_data }]
export async function sendEvents(events) {
  const body = {
    data: events,
    ...(process.env.META_TEST_EVENT_CODE && { test_event_code: process.env.META_TEST_EVENT_CODE }),
  };

  const url = `https://graph.facebook.com/${CAPI_VERSION}/${process.env.META_DATASET_ID}/events?access_token=${process.env.META_CAPI_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('capi_send_failed', { status: res.status, payload, events: events.map((e) => e.event_name) });
    return { ok: false, payload };
  }
  return { ok: true, payload };
}

export function makeEvent({ name, eventId, lead, ctx, custom = {}, sourceUrl, actionSource = 'website' }) {
  return {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId, // shared with the browser pixel so Meta collapses the pair
    event_source_url: sourceUrl || lead.landing_url || undefined,
    action_source: actionSource,
    user_data: buildUserData(lead, ctx),
    custom_data: custom,
  };
}