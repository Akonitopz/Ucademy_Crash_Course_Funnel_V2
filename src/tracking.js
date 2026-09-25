// Ucademy consultation funnel - client tracking layer
// Module scope only. Import into App.jsx; never redefine inside a component.
//
// Upper-funnel events fire unfiltered and drive delivery and retargeting.
// The optimisation event (invitee_meeting_scheduled) is NOT fired from here:
// it comes server-side from the LMS/CRM booking webhook. See event-map.md.

const DATASET_ID = '240982503831160';
const STORE_KEY = 'ucad_attr';
const CONSENT_KEY = 'ucad_consent';
const LEAD_ENDPOINT = '/api/lead';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
const STANDARD_EVENTS = ['PageView', 'ViewContent', 'Lead', 'CompleteRegistration', 'InitiateCheckout', 'Contact'];

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function readCookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.split('=').slice(1).join('=')) : null;
}

function load() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

function save(obj) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* private mode */ }
}

// --- consent -----------------------------------------------------------
// UK GDPR and PECR: the pixel sets _fbp, a non-essential cookie. Bootstrap
// with consent revoked, grant only after the banner.

export function hasConsent() {
  try { return localStorage.getItem(CONSENT_KEY) === 'granted'; } catch { return false; }
}

export function setConsent(granted) {
  try { localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied'); } catch { /* ignore */ }
  if (window.fbq) window.fbq('consent', granted ? 'grant' : 'revoke');
  if (granted) track('PageView');
}

export function initPixel() {
  if (window.fbq) return;
  /* eslint-disable */
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('consent', hasConsent() ? 'grant' : 'revoke');
  window.fbq('init', DATASET_ID);
  if (hasConsent()) track('PageView');
}

// --- attribution -------------------------------------------------------
// Step 1 of the identity plumbing. If this fails, everything downstream
// sends successfully and matches badly.

export function captureAttribution() {
  const params = new URLSearchParams(window.location.search);
  const next = load();

  UTM_KEYS.forEach((k) => {
    const v = params.get(k);
    if (v) next[k] = v.slice(0, 200);
  });

  const fbclid = params.get('fbclid');
  if (fbclid) {
    next.fbclid = fbclid;
    next.fbc = `fb.1.${Date.now()}.${fbclid}`; // subdomain index 1 = ucademy.co.uk
  }

  next.session_id = next.session_id || uuid();
  next.landing_url = next.landing_url || window.location.href.split('#')[0];
  next.referrer = next.referrer || document.referrer || null;
  next.form_started_at = next.form_started_at || Date.now();

  save(next);
  return next;
}

// Re-read cookies each call: _fbp only exists after the pixel loads, which
// only happens after consent, which is after captureAttribution().
export function getAttribution() {
  const stored = load();
  return {
    ...stored,
    fbp: readCookie('_fbp') || null,
    fbc: readCookie('_fbc') || stored.fbc || null,
    page_url: window.location.href.split('#')[0],
  };
}

// --- events ------------------------------------------------------------
// Returns the event_id so the server can send the same one to CAPI.

export function track(eventName, custom = {}, opts = {}) {
  const eventId = opts.eventId || uuid();
  if (window.fbq && hasConsent()) {
    const method = STANDARD_EVENTS.includes(eventName) ? 'track' : 'trackCustom';
    window.fbq(method, eventName, custom, { eventID: eventId });
  }
  return eventId;
}

// Upper funnel. Unfiltered, always. These drive delivery and retargeting.
export const trackQuizStart = () => track('ViewContent', { content_name: 'consultation_quiz' });
export const trackYearSelected = (year) => track('YearSelected', { year_group: year });
export const trackSubjectsSelected = (subjects) => track('SubjectsSelected', { subjects: subjects.join(',') });
export const trackTestimonialPlay = (id) => track('TestimonialPlay', { content_name: 'consultation_proof', video_id: id });

// --- submission --------------------------------------------------------
// Fires Lead in the browser and server-side with a shared event_id.
// answers must carry role (parent|student), year_group and region: the two
// new fields the brief asks for, plus geography for the rules.

export async function submitLead(answers, contact, honeypot) {
  const attribution = getAttribution();
  const eventId = track('Lead', { content_name: 'grade_boosting_consultation' });

  const res = await fetch(LEAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, answers, contact, honeypot, attribution }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `lead_submit_failed_${res.status}`);
    // Server flags which field failed (e.g. phone lookup came back inactive)
    // so the form can show the error next to the right input.
    if (body.field) err.field = body.field;
    if (body.message) err.message = body.message;
    throw err;
  }
  return res.json(); // { leadId, bookingUrl }
}

// Tap-through to the LMS booking page. Time selection equivalent, upper
// funnel, unfiltered. This is NOT the booking and must not be optimised on
// once the real booking webhook exists.
export function trackBookingClick(leadId) {
  return track('InitiateCheckout', { content_name: 'consultation_booking_page', lead_id: leadId });
}