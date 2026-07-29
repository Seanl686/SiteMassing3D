// Calling Claude directly from the page to read a floor plan.
//
// This is the optional half of the plan-reading feature. The other half needs
// no key at all: copy the prompt, paste it into whatever assistant you already
// have open along with the plan PNG, paste the JSON back. That path always
// works and is what most people should use.
//
// This path exists because the paste-back round trip is four manual steps, and
// once you are reading a folder of twenty homes that adds up. It sends the
// converted plan page and the schema from homespec.js straight to the Messages
// API and hands the answer to the same validator.
//
// On the key: it is the user's own key, typed by the user, held in memory for
// the session by default and never sent anywhere except api.anthropic.com. It
// is offered because this is a local single-user tool. It is NOT a good pattern
// for anything served to other people — a key in a browser is readable by any
// script on the page, so a hosted version of this app should proxy through a
// server instead.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = 'claude-opus-5';
const STORE_KEY = 'sitemassing3d.apikey';

/**
 * Where the key lives. Session storage is the default: it dies with the tab,
 * which is the right trade for a credential that only saves a few keystrokes.
 * Persisting is opt-in and says so in the UI.
 */
export function loadApiKey() {
  try {
    return sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(key, persist) {
  try {
    sessionStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_KEY);
    if (!key) return;
    (persist ? localStorage : sessionStorage).setItem(STORE_KEY, key);
  } catch { /* private mode — the key just stays in the field for this session */ }
}

export const isPersisted = () => {
  try { return !!localStorage.getItem(STORE_KEY); } catch { return false; }
};

/** Split a data URL into the media type and bare base64 the API wants. */
function imageSource(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('the site plan is not a base64 image');
  const mediaType = m[1].toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) {
    throw new Error(`${mediaType} is not an image type the API accepts`);
  }
  return { type: 'base64', media_type: mediaType, data: m[2] };
}

/** Turn an API error body into something worth showing a user. */
function describeError(status, body) {
  const message = body?.error?.message || body?.message || '';
  if (status === 401) return 'That API key was rejected. Check it starts with "sk-ant-" and is still active.';
  if (status === 403) return `The key does not have access to ${MODEL}. ${message}`;
  if (status === 429) return 'Rate limited by the API. Wait a moment and try again.';
  if (status === 413) return 'The plan image is too large to send. Re-load it — the converted page is capped at 2200 px.';
  if (status >= 500) return `The API is having trouble (${status}). Try again shortly.`;
  return message || `The API returned ${status}.`;
}

/**
 * Send the plan page and get a home spec back.
 *
 * `schema` and `prompt` come from homespec.js so this module owns the transport
 * and nothing else. The answer is returned unvalidated — validateHomeSpec() is
 * the caller's next call, and it is not optional.
 */
export async function readPlanWithClaude({ apiKey, planDataUrl, prompt, schema, signal }) {
  if (!apiKey) throw new Error('no API key');
  if (!planDataUrl) throw new Error('no site plan loaded');

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        // Without this the API refuses browser origins outright. It is named
        // "dangerous" because it means a key is sitting in a web page — true
        // here, and the reason this path is opt-in and session-scoped.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        // Thinking is on by default on this model and shares the max_tokens
        // ceiling with the answer, so leave real headroom: a plan with twenty
        // openings is a long object, and a truncated one parses as nothing.
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: imageSource(planDataUrl) },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // fetch() rejects rather than returning a status when CORS or the network
    // is the problem, and the two are indistinguishable from here.
    throw new Error(`Could not reach the API — check the network, and that the key is pasted whole. (${err.message})`);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(describeError(res.status, body));

  if (body?.stop_reason === 'refusal') {
    throw new Error('The model declined to answer for this image.');
  }
  if (body?.stop_reason === 'max_tokens') {
    throw new Error('The answer was cut off before it finished. The plan may have more openings than one pass can return.');
  }

  const text = (body?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error('The model returned nothing readable.');

  return {
    raw: text,
    usage: body?.usage || null,
    model: body?.model || MODEL,
  };
}
