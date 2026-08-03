/**
 * Vaelro reusable inquiry-form handler (Cloudflare Pages Function).
 * Route: POST /api/inquiry
 *
 * To reuse on another client build, change SITE below and set the three
 * environment variables. Nothing else in this file is client-specific.
 *
 * Required environment variables (Cloudflare Pages > Settings > Environment
 * variables). Set them as SECRETS, not plaintext, and set them for BOTH the
 * production and preview environments or the preview deploy will 500:
 *
 *   RESEND_API_KEY    Resend API key, "re_..."
 *   RECIPIENT_EMAIL   where submissions are delivered
 *   TURNSTILE_SECRET  Turnstile secret paired with the site key in index.html
 *
 * None of these are ever returned to the browser.
 */

/* ---- per-client config ---------------------------------------------- */

const SITE = {
  /** Used in the email subject and body so a shared inbox knows the source. */
  name: 'Health and Fitness Headquarters',
  /** Must be a domain verified in Resend, or sends fail with 403. */
  from: 'HFH Website <forms@vaelro.co>',
};

/* ---- constants ------------------------------------------------------- */

const LIMITS = {
  name: 120,
  email: 254, // RFC 5321 practical maximum
  phone: 40,
  message: 5000,
};

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Cloudflare's universal TEST secret. Always passes. Used only when
 * TURNSTILE_SECRET is unset so the form is testable before the real key is
 * added. TODO: set TURNSTILE_SECRET in Pages and this fallback stops applying.
 */
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/* Deliberately loose: something@something.tld. Real validation is the reply. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---- helpers --------------------------------------------------------- */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

/** Coerce anything to a trimmed string and hard-cap it. */
function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * Returns an array of human-readable problems. Empty means valid.
 * Mirrors the client-side rules so a scripted post cannot bypass them.
 */
function validate(fields) {
  const problems = [];
  if (!fields.name) problems.push('name');
  if (!fields.email || !EMAIL_RE.test(fields.email)) problems.push('email');
  if (!fields.message) problems.push('message');
  return problems;
}

async function verifyTurnstile(token, secret, remoteIp) {
  if (!token) return false;

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    // Network failure verifying: fail closed rather than let spam through.
    return false;
  }
}

function buildEmailText(fields, meta) {
  return [
    `New inquiry from the ${SITE.name} website.`,
    '',
    `Name:    ${fields.name}`,
    `Email:   ${fields.email}`,
    `Phone:   ${fields.phone || '(not provided)'}`,
    '',
    'Message:',
    fields.message,
    '',
    '---',
    `Submitted: ${meta.submittedAt}`,
    `Reply directly to this email to answer ${fields.name}.`,
  ].join('\n');
}

async function sendEmail(fields, env, meta) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: SITE.from,
      to: [env.RECIPIENT_EMAIL],
      reply_to: fields.email,
      subject: `New website inquiry from ${fields.name}`,
      text: buildEmailText(fields, meta),
    }),
  });

  if (!res.ok) {
    // Log the provider's reason server-side; never surface it to the browser.
    const detail = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, detail);
    return false;
  }
  return true;
}

/* ---- handlers -------------------------------------------------------- */

export async function onRequestPost({ request, env }) {
  // Require a JSON body. Blocks naive cross-origin form posts, which cannot
  // set this content type without triggering a preflight.
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return json({ ok: false, error: 'Expected JSON.' }, 415);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Could not read that request.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return json({ ok: false, error: 'Could not read that request.' }, 400);
  }

  // Honeypot. Humans never see this field, so anything in it is a bot.
  // Answer 200 so the bot records a success and learns nothing. Nothing sends.
  if (str(payload.website, 200)) {
    return json({ ok: true });
  }

  const fields = {
    name: str(payload.name, LIMITS.name),
    email: str(payload.email, LIMITS.email),
    phone: str(payload.phone, LIMITS.phone),
    message: str(payload.message, LIMITS.message),
  };

  const problems = validate(fields);
  if (problems.length) {
    return json(
      { ok: false, error: 'Please check the highlighted fields.', fields: problems },
      400
    );
  }

  const turnstileOk = await verifyTurnstile(
    str(payload.turnstileToken, 4096),
    env.TURNSTILE_SECRET || TURNSTILE_TEST_SECRET,
    request.headers.get('CF-Connecting-IP')
  );
  if (!turnstileOk) {
    return json(
      { ok: false, error: 'We could not verify that you are human. Please try again.' },
      403
    );
  }

  // Misconfiguration is an operator problem, not a visitor problem: log loudly,
  // tell the visitor something generic so they fall back to the phone number.
  if (!env.RESEND_API_KEY || !env.RECIPIENT_EMAIL) {
    console.error(
      'Inquiry form misconfigured: missing',
      !env.RESEND_API_KEY ? 'RESEND_API_KEY' : '',
      !env.RECIPIENT_EMAIL ? 'RECIPIENT_EMAIL' : ''
    );
    return json({ ok: false, error: 'Message could not be sent right now.' }, 500);
  }

  const sent = await sendEmail(fields, env, {
    submittedAt: new Date().toISOString(),
  });
  if (!sent) {
    return json({ ok: false, error: 'Message could not be sent right now.' }, 502);
  }

  return json({ ok: true });
}

/** Catch-all for every other method. */
export async function onRequest() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
