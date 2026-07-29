// Calling AI Vision APIs (Claude, OpenAI, Grok, Gemini) directly from the page
// to read floor plans and observe finishes from home photos.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-opus-5';

export const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-opus-5', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI GPT-4o', defaultModel: 'gpt-4o', placeholder: 'sk-proj-...' },
  { id: 'grok', name: 'xAI Grok Vision', defaultModel: 'grok-2-vision-1212', placeholder: 'xai-...' },
  { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-2.0-flash', placeholder: 'AIza...' },
];

let inMemoryStore = {};

/**
 * Load stored keys and active provider settings.
 */
export function loadApiKeys() {
  try {
    const get = (k) => {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return sessionStorage.getItem(k) || localStorage.getItem(k) || '';
      }
      return inMemoryStore[k] || '';
    };
    return {
      anthropic: get('sitemassing3d.key.anthropic') || get('sitemassing3d.apikey') || '',
      openai: get('sitemassing3d.key.openai') || '',
      grok: get('sitemassing3d.key.grok') || '',
      gemini: get('sitemassing3d.key.gemini') || '',
      activeProvider: get('sitemassing3d.provider') || 'anthropic',
    };
  } catch {
    return { anthropic: '', openai: '', grok: '', gemini: '', activeProvider: 'anthropic' };
  }
}

export function saveApiKeys(keys, persist) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      for (const p of ['anthropic', 'openai', 'grok', 'gemini']) {
        if (keys[p]) inMemoryStore[`sitemassing3d.key.${p}`] = keys[p];
        else delete inMemoryStore[`sitemassing3d.key.${p}`];
      }
      if (keys.activeProvider) inMemoryStore['sitemassing3d.provider'] = keys.activeProvider;
      if (keys.anthropic) inMemoryStore['sitemassing3d.apikey'] = keys.anthropic;
      return;
    }
    const store = persist ? localStorage : sessionStorage;
    const other = persist ? sessionStorage : localStorage;
    for (const p of ['anthropic', 'openai', 'grok', 'gemini']) {
      other.removeItem(`sitemassing3d.key.${p}`);
      if (keys[p]) store.setItem(`sitemassing3d.key.${p}`, keys[p]);
      else store.removeItem(`sitemassing3d.key.${p}`);
    }
    if (keys.activeProvider) store.setItem('sitemassing3d.provider', keys.activeProvider);
    if (keys.anthropic) store.setItem('sitemassing3d.apikey', keys.anthropic);
  } catch { /* private mode */ }
}

export function loadApiKey() {
  const keys = loadApiKeys();
  return keys[keys.activeProvider] || keys.anthropic || '';
}

export function saveApiKey(key, persist) {
  const keys = loadApiKeys();
  keys[keys.activeProvider || 'anthropic'] = key;
  saveApiKeys(keys, persist);
}

export const isPersisted = () => {
  try {
    return !!(
      localStorage.getItem('sitemassing3d.key.anthropic') ||
      localStorage.getItem('sitemassing3d.key.openai') ||
      localStorage.getItem('sitemassing3d.key.grok') ||
      localStorage.getItem('sitemassing3d.key.gemini') ||
      localStorage.getItem('sitemassing3d.apikey')
    );
  } catch {
    return false;
  }
};

/** Split a data URL into the media type and bare base64 the API wants. */
function imageSource(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('image is not a valid base64 data URL');
  const mediaType = m[1].toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) {
    throw new Error(`${mediaType} is not an image type the API accepts`);
  }
  return { type: 'base64', media_type: mediaType, data: m[2] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Distinguishes retryable rate-limits from hard errors. */
class Rate429Error extends Error {
  constructor(msg) { super(msg); this.name = 'Rate429Error'; }
}

/** Turn an API error body into something worth showing a user. */
function describeError(status, body, model) {
  const message = body?.error?.message || body?.message || '';
  if (status === 401) return 'That API key was rejected. Please check your key and make sure it is active.';
  if (status === 403) return `The key does not have access to ${model}. ${message}`;
  if (status === 429) throw new Rate429Error('Rate limited by the API — will retry automatically.');
  if (status === 413) return 'The image is too large to send. Re-load it — image is capped at 2200 px.';
  if (status >= 500) return `The API service returned status ${status}. Try again shortly.`;
  return message || `The API returned status ${status}.`;
}

/**
 * Retry a function up to `maxRetries` times on Rate429Error with exponential backoff.
 * onRetry(attempt, delaySec, providerName) is called before each wait.
 */
async function withRetry(fn, { maxRetries = 3, baseDelay = 2000, signal, onRetry, providerName } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.name !== 'Rate429Error' || attempt >= maxRetries) throw err;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const delay = baseDelay * (2 ** attempt);          // 2 s → 4 s → 8 s
      if (onRetry) onRetry(attempt + 1, delay / 1000, providerName);
      await sleep(delay);
    }
  }
}

/** Send request to Claude API */
export async function readPlanWithClaude({ apiKey, planDataUrl, prompt, schema, signal }) {
  if (!apiKey) throw new Error('no Anthropic API key provided');
  if (!planDataUrl) throw new Error('no image loaded');

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
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
    throw new Error(`Could not reach Anthropic API — check network/CORS or API key. (${err.message})`);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(describeError(res.status, body, CLAUDE_MODEL));

  if (body?.stop_reason === 'refusal') throw new Error('The model declined to answer for this image.');
  if (body?.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished.');

  const text = (body?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new Error('The model returned nothing readable.');

  return { raw: text, usage: body?.usage || null, model: body?.model || CLAUDE_MODEL };
}

/** Send request to OpenAI or xAI Grok Vision API */
async function readPlanWithOpenAI({ provider, apiKey, planDataUrl, prompt, signal }) {
  if (!apiKey) throw new Error(`No API key provided for ${provider}`);
  const isGrok = provider === 'grok';
  const endpoint = isGrok ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isGrok ? 'grok-2-vision-1212' : 'gpt-4o';

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: planDataUrl } },
              { type: 'text', text: `${prompt}\n\nIMPORTANT: Return ONLY raw valid JSON matching the requested structure.` },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Could not reach ${isGrok ? 'xAI Grok' : 'OpenAI'} API. (${err.message})`);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(describeError(res.status, body, model));

  const text = body?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error(`The ${model} model returned no text.`);

  return { raw: text, usage: body?.usage || null, model };
}

/** Send request to Google Gemini API */
async function readPlanWithGemini({ apiKey, planDataUrl, prompt, signal }) {
  if (!apiKey) throw new Error('No API key provided for Google Gemini');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const img = imageSource(planDataUrl);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: img.media_type, data: img.data } },
            { text: `${prompt}\n\nIMPORTANT: Return ONLY valid JSON output matching the schema.` },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Could not reach Google Gemini API. (${err.message})`);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(describeError(res.status, body, 'gemini-2.0-flash'));

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text.trim()) throw new Error('Gemini returned no text response.');

  return { raw: text, usage: body?.usageMetadata || null, model: 'gemini-2.0-flash' };
}

/**
 * Universal dispatch function supporting Anthropic, OpenAI, xAI Grok, and Gemini
 */
export async function readPlanWithAI({ provider = 'anthropic', apiKey, planDataUrl, prompt, schema, signal }) {
  if (provider === 'openai' || provider === 'grok') {
    return readPlanWithOpenAI({ provider, apiKey, planDataUrl, prompt, signal });
  }
  if (provider === 'gemini') {
    return readPlanWithGemini({ apiKey, planDataUrl, prompt, signal });
  }
  return readPlanWithClaude({ apiKey, planDataUrl, prompt, schema, signal });
}

/**
 * Auto-cycles through available API keys (Anthropic -> OpenAI -> Grok -> Gemini)
 * if active provider fails or if provider is set to 'autocycle'.
 * Each provider gets up to 3 retries with exponential backoff on 429 rate limits
 * before the cycle moves to the next provider.
 */
export async function readPlanWithAutoCycle({ keys, provider = 'anthropic', planDataUrl, prompt, schema, signal, onProgress }) {
  const preferred = provider === 'autocycle' ? (keys.activeProvider || 'anthropic') : provider;
  const providerOrder = [preferred, 'anthropic', 'openai', 'grok', 'gemini'].filter(
    (p, i, self) => p && self.indexOf(p) === i
  );

  const errors = [];
  for (const prov of providerOrder) {
    const key = keys[prov]?.trim();
    if (!key) continue;
    try {
      if (onProgress) onProgress(prov);
      const res = await withRetry(
        () => readPlanWithAI({ provider: prov, apiKey: key, planDataUrl, prompt, schema, signal }),
        {
          maxRetries: 3,
          baseDelay: 2000,
          signal,
          providerName: prov,
          onRetry: (attempt, delaySec, name) => {
            if (onProgress) onProgress(name, `rate-limited, retry ${attempt} in ${delaySec}s…`);
          },
        },
      );
      return { ...res, providerUsed: prov };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      errors.push(`${prov.toUpperCase()}: ${err.message}`);
    }
  }
  if (!errors.length) {
    throw new Error('No API keys configured. Please add an API key for Anthropic, OpenAI, Grok, or Gemini.');
  }
  throw new Error(`All configured AI providers failed:\n${errors.join('\n')}`);
}
