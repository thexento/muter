/* Muter — lab page extraction (port of extractor.py)
 *
 * Walks the same DOM structures the Selenium extractor relied on
 * (.answer-block, .fb-label, TinyMCE, CodeMirror, fb-textarea, …) but
 * visits every rendered question so it does not depend on #qN fragments
 * or on switching iframes.
 *
 * Fields are discovered in two passes:
 *   1. every .answer-block (the normal case), and
 *   2. any rich editor / control inside the question container that is not
 *      wrapped in an .answer-block (some lab questions render the TinyMCE
 *      Algorithm box without one).
 * Each discovered field is tagged with data-muter-field so it can be found
 * again reliably when it is time to type.
 */
(function (root) {
  'use strict';

  const SELECTORS = {
    answerBlock: '.answer-block',
    questionBody: '.question-body',
    label: '.fb-label',
    title: 'h2.q-title, .q-title, .question-title, [class*="q-title"], [class*="question-title"]',
    wrapper: '.fb-field, .form-group, .field-group, .question-field',
  };

  const FIELD_ATTR = 'data-muter-field';
  const EDITOR_SELECTOR = '.tox-tinymce, .CodeMirror, .cm-editor';
  const CONTROL_SELECTOR = 'input.fb-input, textarea.fb-textarea, input[type="text"], input[type="file"], textarea';
  const ANSWER_ROLES = ['title', 'theory', 'algorithm', 'source_code', 'output', 'result_conclusion'];

  const ROLE_KEYWORDS = [
    ['title', ['title', 'aim']],
    ['theory', ['theory']],
    ['algorithm', ['algorithm']],
    ['source_code', ['source', 'code', 'program']],
    ['output', ['output']],
    ['result_conclusion', ['result', 'conclusion']],
  ];

  const ROLE_ORDER = ['title', 'theory', 'algorithm', 'source_code', 'output', 'result_conclusion'];

  const has = (el, sel) => Boolean(el?.matches?.(sel) || el?.querySelector?.(sel));

  function roleOf(label, dataField, fieldType) {
    const probe = `${dataField || ''} ${label || ''}`.toLowerCase();
    const type = (fieldType || '').toLowerCase();
    if (type === 'file' || /attach|upload|file|pdf/.test(probe)) return 'attachment';
    for (const [role, words] of ROLE_KEYWORDS) {
      if (words.some((w) => probe.includes(w))) return role;
    }
    if (probe.includes('algorithm') || type === 'tinymce') return 'algorithm';
    if (type === 'codemirror') return 'source_code';
    return 'other';
  }

  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (el.getClientRects().length === 0) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function cssEscape(value) {
    try { return root.CSS?.escape ? root.CSS.escape(value) : String(value).replace(/"/g, '\\"'); }
    catch { return String(value).replace(/"/g, '\\"'); }
  }

  /** Resolve the label that belongs to a field, in the same order as _resolve_field_label. */
  function labelFor(field, wrapper) {
    const id = (field?.getAttribute?.('id') || '').trim();
    const scopes = [wrapper, field?.closest?.(SELECTORS.wrapper)]
      .filter(Boolean)
      .filter((scope, i, all) => all.indexOf(scope) === i);

    if (id) {
      for (const scope of scopes) {
        const forLabel = scope.querySelector?.(`label[for="${cssEscape(id)}"]`);
        const text = (forLabel?.textContent || '').trim();
        if (text) return text;
      }
    }

    for (const scope of scopes) {
      for (const lbl of scope.querySelectorAll(`${SELECTORS.label}, label, .field-label, .form-label`)) {
        const text = (lbl.textContent || '').trim();
        if (text) return text;
      }
    }
    for (const attr of ['aria-label', 'placeholder', 'data-field', 'name']) {
      const val = (field?.getAttribute?.(attr) || '').trim();
      if (val) return val;
    }
    if (wrapper?.dataset?.field) return wrapper.dataset.field;
    return '';
  }

  function hiddenTextareaDataField(wrapper) {
    if (!wrapper?.querySelectorAll) return '';
    for (const ta of wrapper.querySelectorAll('textarea')) {
      const val = (ta.getAttribute('data-field') || '').trim();
      if (val) return val;
    }
    return '';
  }

  /** Decide which editor type a field represents (mirrors _inspect_fields). */
  function probeBlock(block) {
    if (!block) return 'unknown';
    if (block.matches?.('iframe.tox-edit-area__iframe')) return 'tinymce';
    if (has(block, '.tox-tinymce')) return 'tinymce';
    if (has(block, '.CodeMirror') || has(block, '.cm-editor')) return 'codemirror';
    if (has(block, 'input[type="file"]')) return 'file';
    if (block.matches?.('input.fb-input') || has(block, 'input.fb-input')) return 'input.fb-input';
    // TinyMCE may not have finished booting yet — its hidden textarea is a
    // reliable early signal that this block is a rich editor.
    if (has(block, 'textarea.tinymce-field, textarea[class*="tinymce"]')) return 'tinymce';

    const textarea = block.matches?.('textarea')
      ? block
      : Array.from(block.querySelectorAll?.('textarea') || []).find(
        (ta) => !(ta.className || '').toLowerCase().includes('tinymce-field'),
      );
    if (textarea) {
      return (textarea.className || '').toLowerCase().includes('fb-textarea')
        ? 'textarea.fb-textarea'
        : 'textarea';
    }
    if (block.matches?.('[contenteditable="true"]')) return 'contenteditable';
    return 'unknown';
  }

  function firstInput(block) {
    if (block.matches?.('.tox-tinymce, .CodeMirror, .cm-editor, input, textarea, [contenteditable]')) return block;
    return block.querySelector('.tox-tinymce, .CodeMirror, .cm-editor, input.fb-input, input[type="file"], textarea, [contenteditable]');
  }

  function describeBlock(block, index, mark = true) {
    const fieldType = probeBlock(block);
    const input = firstInput(block);
    const dataField = (block.getAttribute('data-field') || input?.getAttribute('data-field') || '').trim();
    const label = (block.querySelector(SELECTORS.label)?.textContent || labelFor(input, block) || '').trim();
    const role = roleOf(label || dataField, dataField, fieldType);
    const id = `muter-field-${index}`;
    if (mark) block.setAttribute(FIELD_ATTR, id);
    return {
      id,
      label: label || dataField || fieldType,
      dataField,
      fieldType,
      role,
      fillable: fieldType !== 'unknown' && fieldType !== 'file',
    };
  }

  /** Describe a rich editor / control that is not wrapped in .answer-block. */
  function describeElement(el, index) {
    const wrapper = el.closest?.(`${SELECTORS.wrapper}, [data-field]`) || el;
    const fieldType = el.matches?.('.tox-tinymce')
      ? 'tinymce'
      : el.matches?.('.CodeMirror, .cm-editor')
        ? 'codemirror'
        : el.matches?.('input[type="file"]')
          ? 'file'
          : el.matches?.('input.fb-input')
            ? 'input.fb-input'
            : el.matches?.('textarea')
              ? ((el.className || '').toLowerCase().includes('fb-textarea') ? 'textarea.fb-textarea' : 'textarea')
              : probeBlock(wrapper);
    const dataField = (el.getAttribute?.('data-field') || wrapper.getAttribute?.('data-field') || hiddenTextareaDataField(wrapper) || '').trim();
    const label = (labelFor(el, wrapper) || wrapper.querySelector?.(SELECTORS.label)?.textContent || '').trim();
    const role = roleOf(label || dataField, dataField, fieldType);
    const id = `muter-field-${index}`;
    (wrapper || el).setAttribute(FIELD_ATTR, id);
    return {
      id,
      label: label || dataField || fieldType,
      dataField,
      fieldType,
      role,
      fillable: fieldType !== 'unknown' && fieldType !== 'file',
    };
  }

  /**
   * All fields for one question container: .answer-blocks first, then any
   * answer-role editor/control that the blocks did not cover.
   */
  function collectFields(container, baseIndex = 0) {
    const blocks = Array.from(container.querySelectorAll(SELECTORS.answerBlock));
    const fields = blocks.map((block, n) => describeBlock(block, baseIndex + n));

    const covered = new Set();
    for (const block of blocks) {
      covered.add(block);
      block.querySelectorAll('*').forEach((node) => covered.add(node));
    }
    const seenWrappers = new Set(
      fields
        .map((f) => container.querySelector(`[${FIELD_ATTR}="${f.id}"]`))
        .filter(Boolean),
    );

    let n = fields.length;
    const candidates = Array.from(container.querySelectorAll(`${EDITOR_SELECTOR}, ${CONTROL_SELECTOR}`));
    for (const el of candidates) {
      if (covered.has(el)) continue;
      if (el.matches?.('textarea') && (el.className || '').toLowerCase().includes('tinymce-field')) continue;
      if (el.matches?.('textarea, input') && !el.matches('input[type="file"]') && !visible(el)) continue;

      const wrapper = el.closest?.(`${SELECTORS.wrapper}, [data-field]`) || el;
      if (seenWrappers.has(wrapper) || wrapper.hasAttribute?.(FIELD_ATTR)) continue;

      const info = describeElement(el, baseIndex + n);
      if (!ANSWER_ROLES.includes(info.role)) continue;
      if (fields.some((f) => f.role === info.role)) continue;

      fields.push(info);
      seenWrappers.add(wrapper);
      n += 1;
    }
    return fields;
  }

  function titleOf(container) {
    const headings = container.querySelectorAll(SELECTORS.title);
    for (const h of headings) {
      const text = (h.textContent || '').trim();
      if (text && !visible(h)) continue;
      if (text && text.toLowerCase() !== 'questions') return text;
    }
    return '';
  }

  /** Detect the total number of questions, following detect_total_questions() strategies. */
  function detectTotal(scope) {
    const indices = new Set();
    const scan = (query) => {
      for (const el of scope.querySelectorAll(query)) {
        for (const attr of ['href', 'data-target', 'data-bs-target', 'onclick', 'data-question-index', 'data-q']) {
          const val = el.getAttribute?.(attr) || '';
          for (const m of val.matchAll(/#q(\d+)\b/g)) indices.add(Number(m[1]));
          if ((attr === 'data-question-index' || attr === 'data-q') && /^\d+$/.test(val.trim())) {
            indices.add(Number(val.trim()));
          }
        }
      }
    };
    scan("a[href*='#q'], [data-target*='#q'], [data-bs-target*='#q'], [onclick*='#q'], [data-question-index], [data-q]");
    if (indices.size) return Math.max(indices.size, Math.max(...indices) + 1);

    const counter = root.document.body?.innerText || '';
    const pageMatch = counter.match(/question\s+\d+\s*(?:of|\/)\s*(\d+)|\b\d+\s*\/\s*(\d+)\s*(?:complete)?/i);
    if (pageMatch) {
      const total = Number(pageMatch[1] || pageMatch[2]);
      if (total > 0) return total;
    }
    return null;
  }

  /**
   * Collect every question currently rendered in this document.
   * A question is identified by its .question-body (or by a .answer-block
   * when the body wrapper is missing).
   */
  function extractQuestions(scope) {
    const doc = scope || root.document;
    const bodies = Array.from(doc.querySelectorAll(SELECTORS.questionBody)).filter(visible);
    const total = detectTotal(doc);
    const questions = [];

    const fromBody = (body, i) => {
      const container = body.closest('form, .question-card, [class*="question"]') || body;
      const fields = collectFields(container, i * 100);
      fields.forEach((f) => { f.questionIndex = i; });
      const title = titleOf(container) || titleOf(body) || firstTextLine(body);
      return { index: i, title, fields };
    };

    if (bodies.length) {
      bodies.forEach((body, i) => questions.push(fromBody(body, i)));
    } else {
      const seen = new Map();
      for (const block of doc.querySelectorAll(SELECTORS.answerBlock)) {
        if (!visible(block)) continue;
        const container = block.closest('form, .question-card, [class*="question"]') || block.parentElement;
        if (!seen.has(container)) seen.set(container, container);
      }
      Array.from(seen.keys()).forEach((container, i) => {
        const fields = collectFields(container, i * 100);
        fields.forEach((f) => { f.questionIndex = i; });
        questions.push({ index: i, title: titleOf(container) || '', fields });
      });
    }

    if (!questions.length) {
      const container = visible(doc.querySelector('form')) ? doc.querySelector('form') : doc.body;
      if (container) {
        const fields = collectFields(container, 0);
        fields.forEach((f) => { f.questionIndex = 0; });
        questions.push({ index: 0, title: titleOf(container) || firstTextLine(container), fields });
      }
    }

    return questions.map((q) => ({
      ...q,
      number: q.index + 1,
      total: total || questions.length,
      fillable: q.fields.filter((f) => f.fillable),
    }));
  }

  function firstTextLine(el) {
    const lines = (el?.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const marker = lines.findIndex((l) => /^Q\d+$/.test(l));
    const window_ = marker >= 0 ? lines.slice(marker + 1) : lines;
    const candidate = window_.find(
      (l) => !/^\d+(?:\.\d+)?\s*marks/i.test(l) && !/^title\/aim/i.test(l) && !/^review & submit/i.test(l),
    );
    return candidate || '';
  }

  /** Re-locate the live block/element for a previously described field. */
  function findBlock(field) {
    if (field?.id) {
      const direct = root.document.querySelector(`[${FIELD_ATTR}="${field.id}"]`);
      if (direct) return direct;
    }

    const all = Array.from(root.document.querySelectorAll(SELECTORS.answerBlock)).filter(visible);
    const sameQuestion = field?.questionIndex >= 0
      ? all.filter((b) => {
        const bodies = Array.from(root.document.querySelectorAll(SELECTORS.questionBody)).filter(visible);
        const body = bodies[field.questionIndex];
        return body ? body.contains(b) : true;
      })
      : all;
    return sameQuestion.find((b) => {
      const label = (b.querySelector(SELECTORS.label)?.textContent || '').trim();
      return (field?.label && label === field.label) ||
        (field?.dataField && (b.getAttribute('data-field') || '').trim() === field.dataField);
    }) || null;
  }

  /** Find a live .answer-block whose role matches, skipping already-used blocks. */
  function liveBlockForRole(role, used) {
    for (const block of root.document.querySelectorAll(SELECTORS.answerBlock)) {
      if (!visible(block) || used?.has(block)) continue;
      const info = describeBlock(block, 999, false);
      if (info.role === role && info.fillable) return block;
    }
    return null;
  }

  root.MuterExtractor = {
    ROLE_ORDER,
    ANSWER_ROLES,
    roleOf,
    extractQuestions,
    findBlock,
    liveBlockForRole,
    probeBlock,
    describeBlock,
    describeElement,
    collectFields,
    visible,
  };
})(typeof window !== 'undefined' ? window : globalThis);
