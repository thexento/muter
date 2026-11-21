/* Muter — Groq client for the extension background context (port of ai_generator.py).
 *
 * Runs in the background script, which is not subject to the page origin's
 * CORS rules: Firefox grants the extension's own origin the hosts it holds.
 * The API key lives in storage.sync (synced by Firefox Add-ons sync) and is
 * never exposed to page scripts.
 */
const MuterAI = (() => {
  'use strict';

  const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const DEFAULT_MODEL = 'openai/gpt-oss-120b';
  const MODEL_ALIASES = { 'llama-3.3-70b-versatile': 'openai/gpt-oss-120b', 'llama-3.1-70b-versatile': 'openai/gpt-oss-120b' };
  const REQUIRED_KEYS = ['title', 'theory', 'algorithm', 'source_code', 'output', 'result_conclusion'];
  const TIMEOUT_MS = 45_000;
  const MAX_TOKENS = 2_600;

  const SYSTEM_PROMPT = `You are a BSc. CSIT undergraduate student preparing a basic C programming lab report.
You must respond ONLY with strictly valid JSON matching the exact schema below.
Do not wrap the JSON in Markdown code fences (no \`\`\`json or \`\`\`).
Do not include any introductory, explanatory, or concluding text.

Required JSON schema:
{
  "title": "string",
  "theory": "string",
  "algorithm": "string",
  "source_code": "string",
  "output": "",
  "result_conclusion": "string"
}

Strict Rules:
1. Return ONLY these exact 6 keys. Do not add any extra keys.
2. Every value must be a JSON string.
3. "title": Copy the exact question text word-for-word. Do not paraphrase, alter, or shorten it.
4. "theory": Write approximately two simple sentences in ordinary student-level English explaining the programming concept or relevant C function/operator. Avoid buzzwords, unnecessary technical jargon, or essay-style writing.
5. "algorithm": Write simple numbered steps in the classic C-lab textbook style.
   Rules for each step:
   - Start with "Step 1: Start" and end with "Step N: Stop".
   - Use short imperative verbs: let, read, calculate, display, print, store, set.
   - For variable setup, use "let" followed by the variable names (e.g. "let a, b, sum, diff, prod, quot").
   - For input, use "Read <what>" (e.g. "Read two integers", "Read the value of n").
   - For operations, use "calculate <var> = <expression>" with the real variable names and operators (e.g. "calculate sum = a + b", "calculate quot = a / b").
   - For output, use "Display <what>" or "Print <what>".
   - Do not add comments, do not use words like "ask", "prompt", "obtain".
   - Keep it under ~10 steps unless the question genuinely needs more.
   Example style for "sum, difference, product, quotient of two numbers":
     Step 1: Start
     Step 2: let variables a, b, sum, diff, prod, quot
     Step 3: Read two integers
     Step 4: calculate sum = a + b
     Step 5: calculate diff = a - b
     Step 6: calculate prod = a * b
     Step 7: calculate quot = a / b
     Step 8: Display results
     Step 9: Stop
6. "source_code": Write a complete, working C program with necessary header files, using int main() unless another signature is required, 4-space indentation, readable variable names, basic introductory C concepts, and return 0; where appropriate. Do NOT include any code comments (no // or /* */). Preserve newlines and indentation using \\n inside the JSON string.
7. "output": Always return an empty string "".
8. "result_conclusion": Write one short sentence in simple student-level English explaining what the program successfully accomplished.`;

  class MuterAIError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'MuterAIError';
      this.code = code;
    }
  }

  const api = globalThis.browser ?? globalThis.chrome;

  async function config() {
    const stored = (await api.storage.sync.get(['groqKey', 'groqModel']).catch(() => ({}))) || {};
    const key = String(stored.groqKey || '').trim();
    const rawModel = String(stored.groqModel || DEFAULT_MODEL).trim();
    return { key, model: MODEL_ALIASES[rawModel] || rawModel || DEFAULT_MODEL };
  }

  function validate(raw, expectedTitle) {
    console.log('[Muter] parsing response ...');
    if (!raw || !raw.trim()) throw new MuterAIError('invalid', 'Empty response from Groq.');
    const cleaned = raw.trim();
    if (cleaned.startsWith('```')) throw new MuterAIError('invalid', 'Response was wrapped in Markdown fences.');
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new MuterAIError('invalid', `Invalid JSON: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MuterAIError('invalid', 'JSON root must be an object.');
    }
    const keys = Object.keys(parsed);
    const missing = REQUIRED_KEYS.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !REQUIRED_KEYS.includes(k));
    if (missing.length) throw new MuterAIError('invalid', `Missing keys: ${missing.join(', ')}`);
    if (extra.length) throw new MuterAIError('invalid', `Unexpected keys: ${extra.join(', ')}`);
    for (const key of REQUIRED_KEYS) {
      if (typeof parsed[key] !== 'string') throw new MuterAIError('invalid', `Value for '${key}' must be a string.`);
    }
    if (parsed.output !== '') throw new MuterAIError('invalid', "'output' must be an empty string.");
    for (const key of REQUIRED_KEYS.filter((k) => k !== 'output')) {
      if (!parsed[key].trim()) throw new MuterAIError('invalid', `'${key}' must not be empty.`);
    }
    parsed.title = expectedTitle;
    return parsed;
  }

  function buildUserPrompt(question) {
    const fieldLines = (question.fields || []).map((f, i) =>
      `${i + 1}. ${f.label} (type: ${f.fieldType}, role: ${f.role})${f.dataField ? ` [data-field=${f.dataField}]` : ''}`);
    const summary = fieldLines.length
      ? fieldLines.join('\n')
      : '1. Title/Aim\n2. Theory\n3. Algorithm\n4. Source Code\n5. Output\n6. Result/Conclusion';
    return `Question ${question.number}:\n${question.title}\n\n` +
      `Detected form fields on the lab page:\n${summary}\n\n` +
      `Generate the JSON object now. Remember: "title" must be exactly:\n${JSON.stringify(question.title)}`;
  }

  async function complete(messages, model, key, jsonMode = true) {
    console.log('[Muter] groq api POST (model, endpoint)', model, ENDPOINT);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          messages,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new MuterAIError('network', e.name === 'AbortError'
        ? 'Groq timed out — try again.'
        : `Network error reaching Groq: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new MuterAIError('auth', 'Groq rejected the API key. Paste a valid gsk_… key in AI settings.');
    }
    if (response.status === 429) {
      throw new MuterAIError('rate', 'Groq rate limit hit — wait a few seconds and retry.');
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      const body = await response.text().catch(() => '');
      const msg = body.slice(0, 300);
      if (jsonMode && /response_format|json/i.test(msg)) {
        return complete(messages, model, key, false);
      }
      throw new MuterAIError('rejected', `Groq rejected the request (${response.status}): ${msg}`);
    }
    if (!response.ok) {
      throw new MuterAIError('status', `Groq returned HTTP ${response.status}.`);
    }
    console.log('[Muter] groq response (status)', response.status);
    const data = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new MuterAIError('empty', 'Groq returned an empty completion.');
    return content;
  }

  async function keyOf() {
    const { key } = await config();
    if (!key || key === 'your_api_key_here') {
      throw new MuterAIError('config', 'No Groq API key yet. Open Muter → AI settings and paste one.');
    }
    return key;
  }

  async function generate(question) {
    console.log('[Muter] groq generate (question)', question.number, question.title);
    const { model } = await config();
    const key = await keyOf();
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(question) },
    ];
    const first = await complete(messages, model, key);
    try {
      return validate(first, question.title);
    } catch (err) {
      if (!(err instanceof MuterAIError)) throw err;
      const correction = messages.concat([
        { role: 'assistant', content: first },
        {
          role: 'user',
          content: `Your previous response was invalid: ${err.message}\n` +
            'Return ONLY strictly valid raw JSON with no markdown fences and exact keys: ' +
            'title, theory, algorithm, source_code, output, result_conclusion. Keep "output" as "".',
        },
      ]);
      const second = await complete(correction, model, key);
      try {
        return validate(second, question.title);
      } catch (err2) {
        throw new MuterAIError('invalid', `Groq failed to produce valid JSON after retry: ${err2.message}`);
      }
    }
  }

  return { generate, config, MuterAIError, validate, DEFAULT_MODEL };
})();

globalThis.MuterAI = MuterAI;
