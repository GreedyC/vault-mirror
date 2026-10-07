// @ts-check
// A real WordPiece token counter, built from the model's own tokenizer.json.
// It mirrors the BERT normaliser and pre-tokeniser the model was trained with,
// so a count here is the count the model sees. No estimate anywhere.

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const UNI_PUNCT = /\p{P}/u;
const MARK = /\p{Mn}/gu;
const CONTROL = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}]/u;

/** @param {number} cp */
function isCjk(cp) {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df)
    || (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);
}

/**
 * Build a counter from a parsed tokenizer.json. Throws when the file is not one this counter understands.
 * @param {any} tokenizer
 * @returns {{ count: (text: string) => number, tokenize: (text: string) => string[] }}
 */
export function createWordPiece(tokenizer) {
  const model = tokenizer && tokenizer.model;
  const norm = tokenizer && tokenizer.normalizer;
  if (!model || model.type !== 'WordPiece' || !model.vocab || typeof model.vocab !== 'object') {
    throw Object.assign(new Error('This tokenizer file is not a WordPiece tokenizer.'), { code: 'VM_E_MODEL_BROKEN' });
  }
  if (!norm || norm.type !== 'BertNormalizer') {
    throw Object.assign(new Error('This tokenizer file uses a normaliser this counter does not understand.'), { code: 'VM_E_MODEL_BROKEN' });
  }
  const vocab = new Map(Object.entries(model.vocab));
  const prefix = model.continuing_subword_prefix || '##';
  const maxChars = model.max_input_chars_per_word || 100;
  const lowercase = norm.lowercase !== false;
  const stripAccents = norm.strip_accents == null ? lowercase : Boolean(norm.strip_accents);
  const cleanText = norm.clean_text !== false;
  const spaceCjk = norm.handle_chinese_chars !== false;
  const unknown = model.unk_token || '[UNK]';
  /** @type {Map<string, number>} */
  const cache = new Map();

  /** @param {string} text @returns {string[]} words after normalising and splitting at whitespace and punctuation */
  function words(text) {
    /** @type {string[]} */
    const out = [];
    let current = '';
    const flush = () => { if (current) { out.push(current); current = ''; } };
    let s = stripAccents ? text.normalize('NFD').replace(MARK, '') : text;
    if (lowercase) s = s.toLowerCase();
    if (stripAccents && lowercase) s = s.normalize('NFD').replace(MARK, '');
    for (const ch of s) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      if (cp === 0xfeff) continue;
      if (ch === '\t' || ch === '\n' || ch === '\r' || /\s/u.test(ch)) { flush(); continue; }
      if (cleanText && (cp === 0 || cp === 0xfffd || CONTROL.test(ch))) continue;
      if ((spaceCjk && isCjk(cp)) || ASCII_PUNCT.test(ch) || UNI_PUNCT.test(ch)) { flush(); out.push(ch); continue; }
      current += ch;
    }
    flush();
    return out;
  }

  /** @param {string} word @returns {string[]} */
  function pieces(word) {
    const chars = Array.from(word);
    if (chars.length > maxChars) return [unknown];
    /** @type {string[]} */
    const out = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length; let hit = null;
      while (start < end) {
        const piece = (start > 0 ? prefix : '') + chars.slice(start, end).join('');
        if (vocab.has(piece)) { hit = piece; break; }
        end--;
      }
      if (!hit) return [unknown];
      out.push(hit);
      start = end;
    }
    return out;
  }

  /** @param {string} word */
  function countWord(word) {
    let n = cache.get(word);
    if (n === undefined) {
      n = pieces(word).length;
      if (cache.size < 200000) cache.set(word, n);
    }
    return n;
  }

  return {
    count(text) { let n = 0; for (const w of words(text)) n += countWord(w); return n; },
    tokenize(text) { return words(text).flatMap(pieces); },
  };
}
