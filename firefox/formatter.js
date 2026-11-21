/* Muter — fill.txt-compatible formatting and answer persistence (port of formatter.py).
 *
 * Answers are kept in browser.storage.local so they survive page reloads and
 * are shared across tabs. Keys are stable and prefixed with "muter.".
 */
(function (root) {
  'use strict';

  const SEPARATOR = '='.repeat(40);
  const QUESTION_HEADER_RE = /^QUESTION\s+(\d+)\s*$/;

  const SECTION_HEADERS = {
    'QUESTION:': 'question',
    'TITLE:': 'title',
    'THEORY:': 'theory',
    'ALGORITHM:': 'algorithm',
    'SOURCE CODE:': 'source_code',
    'OUTPUT:': 'output',
    'RESULT/CONCLUSION:': 'result_conclusion',
  };

  const entryKey = (url, number) => `muter.answers.${url}#q${number}`;

  function trimOuterBlankLines(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start] === '') start += 1;
    while (end > start && lines[end - 1] === '') end -= 1;
    return lines.slice(start, end).join('\n');
  }

  const clean = (v) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n');

  /** Format one entry exactly like formatter.format_question_block(). */
  function formatQuestionBlock(entry) {
    const lines = [
      SEPARATOR,
      `QUESTION ${entry.question_number}`,
      SEPARATOR,
      '',
      'QUESTION:',
      clean(entry.question).trim(),
      '',
      'TITLE:',
      clean(entry.title).trim(),
      '',
      'THEORY:',
      clean(entry.theory).trim(),
      '',
      'ALGORITHM:',
      clean(entry.algorithm).trim(),
      '',
      'SOURCE CODE:',
      clean(entry.source_code).replace(/\n+$/, ''),
      '',
      'OUTPUT:',
      clean(entry.output).replace(/\n+$/, ''),
      '',
      'RESULT/CONCLUSION:',
      clean(entry.result_conclusion).trim(),
      '',
    ];
    return lines.join('\n');
  }

  /** Parse fill.txt text back into entries, preserving code indentation. */
  function parseFillText(content) {
    if (!content || !content.trim()) return {};
    const lines = content.split(/\r\n?|\n/);
    const entries = {};
    let currentNumber = null;
    let currentSection = null;
    let buffers = {};

    const finalize = () => {
      if (currentNumber === null) return;
      const pick = (key) => trimOuterBlankLines(buffers[key] || []);
      entries[currentNumber] = {
        question_number: currentNumber,
        question: pick('question'),
        title: pick('title'),
        theory: pick('theory'),
        algorithm: pick('algorithm'),
        source_code: pick('source_code'),
        output: pick('output'),
        result_conclusion: pick('result_conclusion'),
      };
    };

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const stripped = raw.trim();
      if (stripped === SEPARATOR && i + 2 < lines.length && lines[i + 2].trim() === SEPARATOR) {
        const m = QUESTION_HEADER_RE.exec(lines[i + 1].trim());
        if (m) {
          finalize();
          currentNumber = Number(m[1]);
          currentSection = null;
          buffers = Object.fromEntries(Object.values(SECTION_HEADERS).map((k) => [k, []]));
          i += 2;
          continue;
        }
      }
      if (currentNumber !== null && Object.prototype.hasOwnProperty.call(SECTION_HEADERS, stripped)) {
        currentSection = SECTION_HEADERS[stripped];
        continue;
      }
      if (currentNumber !== null && currentSection) buffers[currentSection].push(raw);
    }
    finalize();
    return entries;
  }

  /** Build an entry (all fill.txt sections) from a generated answer object. */
  function entryFromAnswers(question, answers) {
    return {
      question_number: question.number,
      question: question.title,
      title: answers.title || '',
      theory: answers.theory || '',
      algorithm: answers.algorithm || '',
      source_code: answers.source_code || '',
      output: answers.output || '',
      result_conclusion: answers.result_conclusion || '',
    };
  }

  function bytes(text) {
    return new TextEncoder().encode(text).length;
  }

  /** storage.local wrapper with graceful degradation. */
  const store = {
    ready: false,
    area: null,
    memory: new Map(),
    async init() {
      if (this.ready) return;
      try {
        const api = root.browser ?? root.chrome;
        if (api?.storage?.local) {
          this.area = api.storage.local;
          await this.area.get('muter.init');
        }
      } catch {
        this.area = null;
      }
      this.ready = true;
    },
    async get(key) {
      await this.init();
      if (this.area) {
        try {
          const hit = await this.area.get(key);
          return hit?.[key] ?? null;
        } catch { /* fall through to memory */ }
      }
      return this.memory.get(key) ?? null;
    },
    async set(key, value) {
      await this.init();
      this.memory.set(key, value);
      if (this.area) {
        try { await this.area.set({ [key]: value }); } catch { /* quota or IO */ }
      }
    },
    async remove(key) {
      await this.init();
      this.memory.delete(key);
      if (this.area) {
        try { await this.area.remove(key); } catch { /* ignore */ }
      }
    },
  };

  root.MuterFormat = {
    entryKey,
    formatQuestionBlock,
    parseFillText,
    entryFromAnswers,
    bytes,
    store,
  };
})(typeof window !== 'undefined' ? window : globalThis);
