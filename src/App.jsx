import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initPixel, setConsent, hasConsent, captureAttribution,
  trackQuizStart, trackYearSelected, trackSubjectsSelected,
  trackProofSeen, submitLead, trackBookingClick,
} from './tracking';

// ---------------------------------------------------------------------
// Content. Keep copy here so it's easy to hand to Usman for sign-off
// without touching component logic.
// ---------------------------------------------------------------------

const YEARS = [
  { id: 'year_7', label: 'Year 7' }, { id: 'year_8', label: 'Year 8' },
  { id: 'year_9', label: 'Year 9' }, { id: 'year_10', label: 'Year 10' },
  { id: 'year_11', label: 'Year 11' }, { id: 'year_12', label: 'Year 12' },
  { id: 'year_13', label: 'Year 13' }, { id: 'resit', label: 'Resitting exams' },
];

const PROGRAMME_BY_YEAR = {
  year_7: 'ks3', year_8: 'ks3', year_9: 'ks3',
  year_10: 'gcse', year_11: 'gcse', resit: 'gcse',
  year_12: 'a_level', year_13: 'a_level',
};

const SUBJECTS = {
  ks3: ['Maths', 'English', 'Science', 'Something else'],
  gcse: ['Maths', 'English', 'Combined Science', 'Separate Sciences', 'Something else'],
  a_level: ['Maths', 'Biology', 'Chemistry', 'Physics', 'Something else'],
};

const GRADES = {
  ks3: ['Behind where they should be', 'About right', 'Ahead, want to stretch further'],
  gcse: ['Grade 1-3', 'Grade 4-5', 'Grade 6-7', 'Grade 8-9', 'Not sure yet'],
  a_level: ['Grade D or below', 'Grade C', 'Grade B', 'Grade A/A*', 'Not sure yet'],
};

const THINGS_THE_CALL_UNCOVERS = [
  'Exactly which topics are costing the most marks right now',
  'Whether the gap is understanding, exam technique, or confidence',
  'A realistic target grade given the time left before exams',
  'Which board and paper structure applies, so revision isn\'t wasted on the wrong content',
  'What a weekly plan looks like alongside school and other commitments',
  'Whether one-to-one, small group, or the crash course format fits best',
];

const WHO_ITS_FOR = [
  'Parents of a child in Year 7 through Year 13 in the UK or UAE',
  'Students resitting GCSE or A-Level exams',
  'Families who want a plan before choosing any tutoring, not a sales pitch',
];

const WHO_ITS_NOT_FOR = [
  'Looking for a same-day tutor with no diagnostic first',
  'Outside the UK or UAE',
  'A student booking without a parent or guardian aware',
];

// Testimonial videos, embedded from Google Drive.
// id: the Drive file ID. Each file MUST be shared "Anyone with the link -
// Viewer" or parents see a Google sign-in wall instead of the video.
// caption: shown under the player. Leave empty until we have permission to
// name the student.
//
// Drive is a stopgap, not the destination. See the note in the proof section
// below before this goes behind real ad spend.
const TESTIMONIALS = [
  { id: '1e_Fxad0rXhiTVSOg_8aUDVTX7uMAUzEI', caption: '' },
  { id: '1fgwu2p09XwWmgwwdsu3mmLCmlXAz54HY', caption: '' },
  { id: '1freL_TMGunIH8moQCTr5kkjOm6e8XE2o', caption: '' },
  { id: '1k2sPpKT9URjpyYO2KswCppsN1IXn4IuR', caption: '' },
];

const TRUSTPILOT_URL = 'https://uk.trustpilot.com/review/ucademy.co.uk';

// Format check only, catches typos and obviously fake numbers before submit.
// Doesn't prove the number is real or reachable - the server-side lookup
// in /api/lead does that.
const PHONE_PATTERNS = {
  UK: /^(?:0|\+?44)7\d{9}$/,
  UAE: /^(?:0|\+?971)5\d{8}$/,
};

function phoneLooksValid(raw, region) {
  const digits = String(raw).replace(/[\s()-]/g, '');
  const pattern = PHONE_PATTERNS[region];
  if (!pattern) return digits.length >= 8; // region not answered yet, don't block typing
  return pattern.test(digits);
}

const FAQS = [
  { q: 'Is the call really free?', a: 'Yes. Thirty minutes, no charge, no obligation to book anything afterwards.' },
  { q: 'What happens on the call?', a: 'Usman or a senior tutor talks through where your child is now, what\'s realistic before their exams, and what a plan would look like. You leave with the plan whether or not you go further with us.' },
  { q: 'Which exam boards do you cover?', a: 'All exam boards at GCSE and IGCSE. A-Level board coverage: TBC.' },
  { q: 'We\'re based in the UAE, does that change anything?', a: 'TBC — confirming call times and who runs UAE consultations.' },
];

// ---------------------------------------------------------------------

function GapMap({ subjects }) {
  const rows = (subjects.length ? subjects : ['Maths', 'English', 'Science']).slice(0, 3);
  const ROW_H = 30;
  const height = rows.length * ROW_H + 6;
  return (
    <svg
      viewBox={`0 0 640 ${height}`}
      className="gap-map"
      role="img"
      aria-label="Where your child is now, and the gap we map on the call"
    >
      <defs>
        {/* Diagonal hatch. SVG fill can't take a CSS gradient, it needs a real
            pattern defined here and referenced by id. */}
        <pattern id="gapHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#f2f1ef" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#8ce5d2" strokeWidth="3" />
        </pattern>
      </defs>
      {rows.map((s, i) => {
        const known = 0.3 + i * 0.14; // 30%, 44%, 58% of the bar
        const trackW = 440;
        const knownW = trackW * known;
        return (
          <g key={s} transform={`translate(0 ${i * ROW_H})`}>
            <text x="0" y="15" className="gap-map-label">{s}</text>
            <rect x="150" y="4" width={trackW} height="14" rx="7" className="gap-map-track" />
            <rect x={150 + knownW} y="4" width={trackW - knownW} height="14" rx="7" className="gap-map-hatch" />
            <rect x="150" y="4" width={knownW} height="14" rx="7" className="gap-map-known" />
          </g>
        );
      })}
    </svg>
  );
}

// Module scope, like everything else here. Defining it inside App() would make
// React treat it as a new component type on every render, remounting the
// iframes and restarting any video a parent was part-way through.
//
// Drive players are cross-origin iframes, so we cannot see play, pause or
// watch time, and we cannot stop one video when another starts. onSeen fires
// once when the wall scrolls into view, which is the only honest signal
// available while the videos live on Drive.
function TestimonialWall({ onSeen }) {
  const wrapRef = useRef(null);
  const seenRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !seenRef.current) {
            seenRef.current = true;
            onSeen();
            io.disconnect();
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onSeen]);

  return (
    <div className="testimonial-grid" ref={wrapRef}>
      {TESTIMONIALS.map((t) => (
        <figure key={t.id} className="testimonial">
          <div className="testimonial-frame">
            <iframe
              src={`https://drive.google.com/file/d/${t.id}/preview`}
              title={t.caption || 'Ucademy student testimonial'}
              allow="autoplay; fullscreen"
              allowFullScreen
              loading="lazy"
            />
          </div>
          {t.caption && <figcaption>{t.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function CalToAction({ label, onClick }) {
  return <button className="cta" onClick={onClick}>{label}</button>;
}

export default function App() {
  const [consentDecided, setConsentDecided] = useState(hasConsent());
  const [quizOpen, setQuizOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ role: '', year_group: '', region: '', subjects: [], grades: '' });
  const [contact, setContact] = useState({ first_name: '', last_name: '', email: '', phone: '', marketing_consent: false });
  const [company, setCompany] = useState(''); // honeypot
  const [startedAt] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [phoneError, setPhoneError] = useState(null);
  const [result, setResult] = useState(null); // { leadId, bookingUrl }
  const quizRef = useRef(null);

  useEffect(() => { initPixel(); captureAttribution(); }, []);

  const programme = PROGRAMME_BY_YEAR[answers.year_group];
  const subjectOptions = SUBJECTS[programme] || [];
  const gradeOptions = GRADES[programme] || [];

  const steps = useMemo(() => ['role', 'year', 'region', 'subjects', 'grades', 'recap', 'contact'], []);

  function openQuiz() {
    setQuizOpen(true);
    setStep(0);
    trackQuizStart();
    setTimeout(() => quizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function next() { setStep((s) => Math.min(s + 1, steps.length - 1)); }
  function back() { setStep((s) => Math.max(s - 1, 0)); }

  function selectYear(id) {
    setAnswers((a) => ({ ...a, year_group: id }));
    trackYearSelected(id);
    next();
  }

  function toggleSubject(s) {
    setAnswers((a) => {
      const has = a.subjects.includes(s);
      const subjects = has ? a.subjects.filter((x) => x !== s) : [...a.subjects, s];
      trackSubjectsSelected(subjects);
      return { ...a, subjects };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!phoneLooksValid(contact.phone, answers.region)) {
      setPhoneError(`Enter a valid ${answers.region || 'UK/UAE'} mobile number.`);
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitLead(
        { ...answers, programme },
        contact,
        { company, started_at: startedAt },
      );
      setResult(res);
    } catch (err) {
      if (err.field === 'phone') {
        setPhoneError(err.message || 'That number doesn\'t look active. Please double check it.');
      } else {
        setError('Something went wrong sending that. Please try again, or WhatsApp us directly.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleBookingClick() {
    if (result?.leadId) trackBookingClick(result.leadId);
  }

  // Upper funnel, unfiltered. A parent who scrolls as far as the proof wall is
  // warmer than one who bounces off the hero, and it makes a retargeting
  // audience worth having. Fires once per page view.
  const seenProofRef = useRef(false);
  const handleProofSeen = useCallback(() => {
    if (seenProofRef.current) return;
    seenProofRef.current = true;
    trackProofSeen();
  }, []);

  return (
    <div className="page">
      {!consentDecided && (
        <div className="consent-bar" role="dialog" aria-label="Cookie consent">
          <p>We use cookies to measure how this page performs. No marketing cookies until you say yes.</p>
          <div className="consent-actions">
            <button className="consent-btn ghost" onClick={() => { setConsent(false); setConsentDecided(true); }}>No thanks</button>
            <button className="consent-btn" onClick={() => { setConsent(true); setConsentDecided(true); }}>Accept</button>
          </div>
        </div>
      )}

      <div className="attention-bar">Free 30-minute Grade Boosting Consultation — Years 7 to 13, GCSE, IGCSE and A-Level resits</div>

      <header className="hero">
        <p className="eyebrow">For parents in the UK and UAE</p>
        <h1>Find out exactly what's holding your child back, before you spend a penny on tutoring.</h1>
        <p className="hero-sub">A free 30-minute call with Ucademy. You leave with a clear plan, whether or not you go further with us.</p>
        <GapMap subjects={answers.subjects} />
        <p className="gap-map-caption">What we map on the call — shown here for a typical student</p>
        <CalToAction label="Book my free consultation" onClick={openQuiz} />
      </header>

      <section className="section founder-letter">
        <h2>From Usman</h2>
        <p>I'm Usman, I studied engineering at the University of Oxford and the University of Birmingham, and I run Ucademy. Most parents call us after months of guessing which tutor, which subject, which exam board detail actually matters. This call exists so you're not guessing. Thirty minutes, no charge, and you'll know precisely where your child stands and what to do next.</p>
      </section>

      <section className="section proof proof-wide">
        <h2>Students who have been here before</h2>
        <p className="proof-sub">Where they started, what got in the way, and what changed. No script, their own words.</p>
        <TestimonialWall onSeen={handleProofSeen} />
        <p className="proof-rating">Rated 4.9 from 150+ reviews on Trustpilot</p>
        <a className="proof-link" href={TRUSTPILOT_URL} target="_blank" rel="noreferrer">Read every review on Trustpilot</a>
      </section>

      <section className="section uncovers">
        <h2>What the call uncovers</h2>
        <ol>
          {THINGS_THE_CALL_UNCOVERS.map((t, i) => <li key={i}><span className="num">{String(i + 1).padStart(2, '0')}</span>{t}</li>)}
        </ol>
        <CalToAction label="Book my free consultation" onClick={openQuiz} />
      </section>

      <section className="section who">
        <div className="who-col">
          <h3>This is for you if</h3>
          <ul>{WHO_ITS_FOR.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="who-col">
          <h3>This isn't for you if you're</h3>
          <ul>{WHO_ITS_NOT_FOR.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </section>

      <section className="section value-stack">
        <h2>What's included</h2>
        <ul>
          <li><span>Full diagnostic conversation</span><span className="tbc-chip">TBC</span></li>
          <li><span>Written summary of the plan</span><span className="tbc-chip">TBC</span></li>
          <li><span>Recommended next steps</span><span className="tbc-chip">TBC</span></li>
        </ul>
        <p className="value-total">Value stack figures awaiting sign-off — shown here as placeholders only.</p>
      </section>

      <section className="section catch">
        <h2>So what's the catch?</h2>
        <p className="tbc-note">Draft, pending Usman's sign-off: there isn't one, this call is how we'd rather earn your trust than run ads at you.</p>
        <CalToAction label="Book my free consultation" onClick={openQuiz} />
      </section>

      <section className="section faq">
        <h2>Questions parents ask</h2>
        {FAQS.map((f) => (
          <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
        ))}
      </section>

      <section className="section quiz-anchor" ref={quizRef}>
        {!quizOpen && (
          <div className="quiz-cta">
            <h2>Ready to find out where your child stands?</h2>
            <CalToAction label="Start — takes 90 seconds" onClick={openQuiz} />
          </div>
        )}

        {quizOpen && !result && (
          <div className="quiz">
            <div className="quiz-progress">Question {Math.min(step + 1, steps.length)} of {steps.length}</div>

            {steps[step] === 'role' && (
              <fieldset>
                <legend>Who's this consultation for?</legend>
                {['parent', 'student'].map((r) => (
                  <button key={r} className="option" onClick={() => { setAnswers((a) => ({ ...a, role: r })); next(); }}>
                    {r === 'parent' ? 'I\'m a parent or guardian' : 'I\'m the student'}
                  </button>
                ))}
              </fieldset>
            )}

            {steps[step] === 'year' && (
              <fieldset>
                <legend>What year are they in?</legend>
                <div className="option-grid">
                  {YEARS.map((y) => (
                    <button key={y.id} className={`option ${answers.year_group === y.id ? 'selected' : ''}`} onClick={() => selectYear(y.id)}>{y.label}</button>
                  ))}
                </div>
                <button className="back" onClick={back}>Back</button>
              </fieldset>
            )}

            {steps[step] === 'region' && (
              <fieldset>
                <legend>Where are you based?</legend>
                {['UK', 'UAE'].map((r) => (
                  <button key={r} className="option" onClick={() => { setAnswers((a) => ({ ...a, region: r })); next(); }}>{r}</button>
                ))}
                <button className="back" onClick={back}>Back</button>
              </fieldset>
            )}

            {steps[step] === 'subjects' && (
              <fieldset>
                <legend>Which subject needs the most support?</legend>
                <div className="option-grid">
                  {subjectOptions.map((s) => (
                    <button key={s} className={`option ${answers.subjects.includes(s) ? 'selected' : ''}`} onClick={() => toggleSubject(s)}>{s}</button>
                  ))}
                </div>
                <div className="quiz-nav">
                  <button className="back" onClick={back}>Back</button>
                  <button className="cta small" disabled={!answers.subjects.length} onClick={next}>Continue</button>
                </div>
              </fieldset>
            )}

            {steps[step] === 'grades' && (
              <fieldset>
                <legend>Where are they at right now?</legend>
                {gradeOptions.map((g) => (
                  <button key={g} className={`option ${answers.grades === g ? 'selected' : ''}`} onClick={() => { setAnswers((a) => ({ ...a, grades: g })); next(); }}>{g}</button>
                ))}
                <button className="back" onClick={back}>Back</button>
              </fieldset>
            )}

            {steps[step] === 'recap' && (
              <fieldset>
                <legend>Here's the gap we'd map on the call</legend>
                <GapMap subjects={answers.subjects} />
                <p className="recap-line">{answers.subjects.join(', ') || 'Their subject'} — currently {answers.grades || 'to be assessed'}, mapped against where they need to be.</p>
                <div className="quiz-nav">
                  <button className="back" onClick={back}>Back</button>
                  <button className="cta small" onClick={next}>Continue to booking</button>
                </div>
              </fieldset>
            )}

            {steps[step] === 'contact' && (
              <form onSubmit={handleSubmit} className="contact-form">
                <p className="form-legend">Where should we send the confirmation?</p>
                <input type="text" name="company" value={company} onChange={(e) => setCompany(e.target.value)} className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" />
                <label>First name<input required value={contact.first_name} onChange={(e) => setContact((c) => ({ ...c, first_name: e.target.value }))} /></label>
                <label>Last name<input value={contact.last_name} onChange={(e) => setContact((c) => ({ ...c, last_name: e.target.value }))} /></label>
                <label>Email<input required type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} /></label>
                <label>
                  Phone
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    value={contact.phone}
                    onChange={(e) => { setContact((c) => ({ ...c, phone: e.target.value })); setPhoneError(null); }}
                    onBlur={() => setPhoneError(contact.phone && !phoneLooksValid(contact.phone, answers.region) ? `Enter a valid ${answers.region || 'UK/UAE'} mobile number.` : null)}
                    aria-invalid={Boolean(phoneError)}
                  />
                  {phoneError && <span className="field-error">{phoneError}</span>}
                </label>
                <label className="checkbox"><input type="checkbox" checked={contact.marketing_consent} onChange={(e) => setContact((c) => ({ ...c, marketing_consent: e.target.checked }))} /> Send me occasional tips and updates from Ucademy</label>
                {error && <p className="form-error">{error}</p>}
                <div className="quiz-nav">
                  <button type="button" className="back" onClick={back}>Back</button>
                  <button type="submit" className="cta small" disabled={submitting}>{submitting ? 'Sending…' : 'Book my consultation'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {result && (
          <div className="confirmation">
            <h2>One step left</h2>
            <p>Pick a time that works for you. Your details are already saved, this just books the slot.</p>
            <a className="cta" href={result.bookingUrl} target="_blank" rel="noreferrer" onClick={handleBookingClick}>Choose my time</a>
          </div>
        )}
      </section>

      <footer className="ps">
        <p><strong>P.S.</strong> if you've skipped straight to the bottom: this is a free 30-minute call with Ucademy to find out exactly where your child stands before GCSE, IGCSE or A-Level exams, and what to do about it. No charge, no obligation.</p>
        <CalToAction label="Book my free consultation" onClick={openQuiz} />
      </footer>

      <style>{`
        :root {
          --white:#ffffff; --mint:#8ce5d2; --yellow:#ffde8d; --coral:#fc8a7b; --red:#e84b37; --ink:#181716;
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .page { font-family: 'Karla', sans-serif; color: var(--ink); background: var(--white); overflow-x: hidden; }
        h1, h2, h3 { font-family: 'Bricolage Grotesque', sans-serif; margin: 0 0 0.5em; line-height: 1.1; }
        .eyebrow, .quiz-progress, .gap-map-caption, .value-total { font-family: 'Space Mono', monospace; font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; }

        .consent-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--ink); color: var(--white); padding: 1rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; z-index: 50; }
        .consent-actions { display: flex; gap: 0.5rem; }
        .consent-btn { padding: 0.5rem 1rem; border: none; border-radius: 999px; background: var(--mint); cursor: pointer; }
        .consent-btn.ghost { background: transparent; color: var(--white); border: 1px solid var(--white); }

        .attention-bar { background: var(--red); color: var(--white); text-align: center; padding: 0.6rem 1rem; font-size: 0.9rem; }

        .hero { padding: 3rem 1.5rem 2.5rem; text-align: center; background: linear-gradient(180deg, var(--mint) 0%, var(--white) 100%); }
        .hero h1 { font-size: clamp(1.5rem, 3.4vw, 2.4rem); max-width: min(38ch, 100%); margin-inline: auto; text-wrap: balance; overflow-wrap: break-word; }
        .hero-sub { max-width: 50ch; margin: 0.75rem auto 1.5rem; }
        .gap-map { width: 100%; max-width: 560px; height: auto; margin: 1.5rem auto 0.25rem; display: block; }
        .gap-map-label { font-family: 'Space Mono', monospace; font-size: 11px; fill: var(--ink); opacity: 0.75; }
        .gap-map-track { fill: #f2f1ef; }
        .gap-map-known { fill: var(--coral); }
        .gap-map-hatch { fill: url(#gapHatch); }

        .cta { background: var(--ink); color: var(--white); border: none; border-radius: 999px; padding: 0.9rem 1.8rem; font-weight: 700; cursor: pointer; font-size: 1rem; display: inline-block; text-decoration: none; margin-top: 1rem; }
        .cta.small { padding: 0.7rem 1.4rem; margin-top: 0; }
        .cta:hover { background: var(--coral); }

        .section { padding: 2.5rem 1.5rem; max-width: 720px; margin: 0 auto; }
        .founder-letter, .catch { background: var(--yellow); border-radius: 24px; max-width: 680px; }
        .proof { text-align: center; }
        .proof-note, .tbc-note { font-size: 0.85rem; opacity: 0.7; }
        .proof-sub { max-width: 46ch; margin: 0 auto 1.75rem; opacity: 0.8; }
        .proof-rating { font-weight: 700; margin: 1.75rem 0 0.25rem; }
        .proof-link { font-family: 'Space Mono', monospace; font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--red); }

        /* Wider than the text sections so two 16:9 players have real size.
           Drive's embedded player renders its controls and overlay at a fixed
           minimum scale, so a narrow column makes them spill past the frame.
           Two columns keeps each player wide enough to behave. */
        .proof-wide { max-width: 900px; }
        .testimonial-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
        @media (max-width: 720px) { .testimonial-grid { grid-template-columns: 1fr; } }
        .testimonial { margin: 0; }
        .testimonial-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: var(--ink); border: 2px solid var(--ink); box-shadow: 0 2px 0 rgba(24, 23, 22, 0.08); }
        .testimonial-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
        .testimonial figcaption { margin-top: 0.6rem; font-size: 0.85rem; text-align: left; opacity: 0.75; }

        .uncovers ol { list-style: none; padding: 0; margin: 1.5rem 0; }
        .uncovers li { display: flex; gap: 1rem; padding: 0.75rem 0; border-top: 1px solid #eee; }
        .num { font-family: 'Space Mono', monospace; color: var(--coral); font-weight: 700; }

        .who { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        .who-col ul { padding-left: 1.2rem; }
        @media (max-width: 640px) { .who { grid-template-columns: 1fr; } }

        .value-stack ul { list-style: none; padding: 0; }
        .value-stack li { display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px dashed #ddd; }
        .tbc-chip { background: var(--yellow); border-radius: 999px; padding: 0.15rem 0.6rem; font-family: 'Space Mono', monospace; font-size: 0.7rem; }

        .faq details { border-top: 1px solid #eee; padding: 0.85rem 0; }
        .faq summary { cursor: pointer; font-weight: 700; }

        .quiz-anchor { background: #faf9f7; border-radius: 24px; }
        .quiz-cta { text-align: center; }
        fieldset { border: none; padding: 0; margin: 0; }
        legend, .form-legend { font-weight: 700; font-size: 1.1rem; margin: 0 0 1rem; padding: 0; font-family: 'Bricolage Grotesque', sans-serif; }
        .option, .option-grid button { display: block; width: 100%; text-align: left; padding: 0.85rem 1rem; margin-bottom: 0.5rem; border: 2px solid #ddd; border-radius: 12px; background: var(--white); cursor: pointer; font-size: 1rem; }
        .option.selected { border-color: var(--coral); background: #fff4f2; }
        .option-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
        .back { background: none; border: none; text-decoration: underline; cursor: pointer; padding: 0.5rem 0; }
        .quiz-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; }
        .recap-line { margin-top: 1rem; }

        .contact-form label { display: block; margin-bottom: 0.9rem; font-weight: 600; }
        .contact-form input[type="text"], .contact-form input[type="email"], .contact-form input[type="tel"] { display: block; width: 100%; padding: 0.7rem 0.9rem; border: 2px solid #ddd; border-radius: 10px; font-size: 1rem; margin-top: 0.3rem; font-weight: 400; }
        .checkbox { display: flex; align-items: center; gap: 0.5rem; font-weight: 400; }
        .hp-field { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
        .form-error { color: var(--red); }
        .field-error { display: block; color: var(--red); font-weight: 400; font-size: 0.85rem; margin-top: 0.3rem; }

        .confirmation { text-align: center; padding: 1rem 0; }

        .ps { background: var(--ink); color: var(--white); text-align: center; padding: 3rem 1.5rem; }
        .ps .cta { background: var(--mint); color: var(--ink); }

        :focus-visible { outline: 3px solid var(--coral); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>
    </div>
  );
}