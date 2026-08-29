// Ucademy consultation funnel - form submit endpoint. Deploy at /api/lead.
//
// Upper-funnel. Per the brief, this event is never filtered. Its job is to
// create the lead record with the click identifiers attached, so that every
// downstream event can be matched and, where required, suppressed.
//
// Env: META_DATASET_ID, META_CAPI_TOKEN, META_TEST_EVENT_CODE,
//      SETTER_WEBHOOK_URL, CRM_WEBHOOK_URL, LMS_BOOKING_URL

import crypto from 'node:crypto';
import { makeEvent, sendEvents, normEmail, normPhone } from './capi.js';

// Free-tier live number check (AbstractAPI: abstractapi.com/phone-validation-api,
// 250 lookups/month free, no card needed to start). Confirms the number is a
// real, active line - not that this particular visitor owns it. If the key
// isn't set, or the API is down, we skip the check rather than block leads.
async function checkPhoneIsActive(phoneE164) {
  const key = process.env.ABSTRACT_PHONE_API_KEY;
  if (!key || !phoneE164) return { checked: false };

  try {
    const url = `https://phonevalidation.abstractapi.com/v1/?api_key=${key}&phone=${phoneE164}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { checked: false };
    const data = await res.json();
    return {
      checked: true,
      valid: Boolean(data.valid),
      type: data.type, // 'mobile' | 'landline' | ...
    };
  } catch {
    // Timeout or network error. Don't let a slow third party block the form.
    return { checked: false };
  }
}

const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
const MIN_FILL_MS = 3000;
const hits = new Map(); // per-container. Move to Upstash before this carries real spend.

const YEAR_GROUPS = ['year_7', 'year_8', 'year_9', 'year_10', 'year_11', 'year_12', 'year_13', 'resit'];

// Programme is inferred from the subject branch the quiz took.
function programmeFor(answers) {
  if (answers.programme) return answers.programme;
  const y = answers.year_group;
  if (['year_7', 'year_8', 'year_9'].includes(y)) return 'ks3';
  if (['year_12', 'year_13'].includes(y)) return 'a_level';
  return 'gcse';
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + RATE_LIMIT.windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + RATE_LIMIT.windowMs; }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > RATE_LIMIT.max;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { contact = {}, answers = {}, honeypot = {}, attribution = {} } = body;

  // Bots only. A 200 with no side effects teaches the scraper nothing.
  const isBot = Boolean(honeypot.company) ||
    (honeypot.started_at && Date.now() - Number(honeypot.started_at) < MIN_FILL_MS);
  if (isBot) return res.status(200).json({ leadId: null, bookingUrl: process.env.LMS_BOOKING_URL });

  // Hard requirements only. Bad phone format and throwaway email are NOT
  // rejected here: the brief keeps those leads in the CRM for the setter and
  // deals with them at the booking event instead.
  const hard = [];
  if (!contact.first_name || String(contact.first_name).trim().length < 2) hard.push('first_name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(normEmail(contact.email))) hard.push('email');
  if (!contact.phone) hard.push('phone');
  if (!YEAR_GROUPS.includes(answers.year_group)) hard.push('year_group');
  if (hard.length) return res.status(400).json({ error: 'validation_failed', fields: hard });

  const phoneE164 = normPhone(contact.phone, answers.region);
  const phoneCheck = await checkPhoneIsActive(phoneE164);
  if (phoneCheck.checked && phoneCheck.valid === false) {
    // Real problem, not a soft signal: block submission and tell the visitor
    // which field to fix, so they can correct a typo on the spot.
    return res.status(400).json({
      error: 'phone_not_active',
      field: 'phone',
      message: "That number doesn't look active. Please double check it.",
    });
  }

  const leadId = crypto.randomUUID();

  const lead = {
    lead_id: leadId,
    created_at: new Date().toISOString(),
    first_name: contact.first_name,
    last_name: contact.last_name || null,
    email: normEmail(contact.email),
    phone: contact.phone,
    phone_e164: phoneE164,
    phone_verified: phoneCheck.checked ? phoneCheck.valid : null, // null = not checked, key not set
    phone_type: phoneCheck.type || null,
    role: answers.role,                 // parent | student  (new field per brief s3)
    year_group: answers.year_group,     // new field per brief s3
    programme: programmeFor(answers),
    subjects: Array.isArray(answers.subjects) ? answers.subjects.join(', ') : answers.subjects,
    grades: answers.grades,
    region: answers.region,
    source: 'landing_page',             // vs 'instant_form', for the split in brief s8
    marketing_consent: Boolean(contact.marketing_consent),
    // Identity plumbing. These must survive onto the CRM record or every
    // downstream event matches badly while appearing to send fine.
    fbp: attribution.fbp || null,
    fbc: attribution.fbc || null,
    fbclid: attribution.fbclid || null,
    client_ip: ip,
    client_user_agent: ua,
    utm_source: attribution.utm_source || null,
    utm_medium: attribution.utm_medium || null,
    utm_campaign: attribution.utm_campaign || null,
    utm_content: attribution.utm_content || null,
    utm_term: attribution.utm_term || null,
    landing_url: attribution.landing_url || null,
  };

  await Promise.allSettled([
    sendEvents([
      makeEvent({
        name: 'Lead',
        eventId: body.event_id, // same id the browser pixel used
        lead,
        ctx: { ip, ua },
        sourceUrl: attribution.page_url,
        custom: {
          content_name: 'grade_boosting_consultation',
          programme: lead.programme,
          region: lead.region,
          utm_campaign: lead.utm_campaign,
        },
      }),
    ]),
    process.env.CRM_WEBHOOK_URL
      ? fetch(process.env.CRM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lead),
        })
      : Promise.resolve(),
    process.env.SETTER_WEBHOOK_URL
      ? fetch(process.env.SETTER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: [
              'New consultation enquiry',
              `${lead.first_name} - ${lead.role || 'role not stated'} - ${lead.year_group} - ${lead.subjects}`,
              `${lead.phone} | ${lead.email}`,
              `Source: ${lead.utm_campaign || 'direct'} / ${lead.utm_content || '-'}`,
              `Ref: ${leadId}`,
            ].join('\n'),
            lead,
          }),
        })
      : Promise.resolve(),
  ]);

  // Opaque reference only. No name, email or phone in the URL.
  return res.status(200).json({ leadId, bookingUrl: `${process.env.LMS_BOOKING_URL}?ref=${leadId}` });
}