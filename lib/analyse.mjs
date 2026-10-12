/**
 * Attribution core: token counts plus *why* the tokens exist.
 *
 * Vocabulary (see docs/v1-implementation-plan.md appendix C):
 *   partial_char_tokens - the token's bytes are not a whole UTF-8 character ("half-character",
 *                         e.g. 饿 = e9 | a5bf). This is the expensive case.
 *   single_cjk_tokens   - one whole Chinese character in one token.
 *   multi_cjk_tokens    - several Chinese characters in one token (the cheap case).
 *   invariant: partial + single_cjk + multi_cjk <= tokens
 *                         (Latin, punctuation, whitespace, emoji, mixed tokens count as none)
 * `chars` is the Unicode code-point count, not the UTF-16 length.
 */
import { rawTokenBytes } from './tokenizers.mjs'

const CJK = /^[\u4e00-\u9fff]$/

/**
 * @typedef {{index:number,id:number,bytes:string,decoded:string,partial:boolean}} Piece
 * @typedef {{tokens:number,chars:number,bytes:number,partial_char_tokens:number,single_cjk_tokens:number,multi_cjk_tokens:number,pieces:Piece[]}} Analysis
 */

/**
 * Pure function: analyse one text with one loaded encoder.
 * @param {import('js-tiktoken/lite').Tiktoken} encoder
 * @param {string} text
 * @returns {Analysis}
 */
export function analyseText(encoder, text) {
  const ids = encoder.encode(text)

  // Byte offsets where a UTF-8 character starts, including the end of the text.
  // Iterating with for..of walks code points, which is what we need (not UTF-16 units).
  const starts = new Set([0])
  let offset = 0
  for (const ch of text) {
    offset += Buffer.byteLength(ch, 'utf8')
    starts.add(offset)
  }

  const pieces = []
  let cursor = 0
  let partial = 0
  let single = 0
  let multi = 0

  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]
    const raw = rawTokenBytes(encoder, id)
    const start = cursor
    const end = cursor + raw.length
    cursor = end

    const isPartial = !(starts.has(start) && starts.has(end))
    const decoded = isPartial ? '' : raw.toString('utf8')

    if (isPartial) {
      partial++
    } else {
      const chars = [...decoded]
      if (chars.length === 1 && CJK.test(decoded)) single++
      else if (chars.length >= 2 && chars.every((c) => CJK.test(c))) multi++
    }

    pieces.push({ index, id, bytes: raw.toString('hex'), decoded, partial: isPartial })
  }

  return {
    tokens: ids.length,
    chars: [...text].length,
    bytes: Buffer.byteLength(text, 'utf8'),
    partial_char_tokens: partial,
    single_cjk_tokens: single,
    multi_cjk_tokens: multi,
    pieces,
  }
}

/** Percentage difference against the cheapest row; 1 decimal, for display only. */
export function deltaVsCheapestPct(tokens, cheapestTokens) {
  return Math.round((tokens / cheapestTokens - 1) * 1000) / 10
}

/** Fixed-template human explanation. Kept deterministic so tests can assert on it. */
export function explainRow(analysis, cheapestTokens) {
  const delta = deltaVsCheapestPct(analysis.tokens, cheapestTokens)
  const pct = delta === 0 ? '0%' : `${delta}%`
  return (
    `${analysis.tokens} tokens (${pct} vs cheapest ${cheapestTokens}): ` +
    `${analysis.partial_char_tokens} half-character, ` +
    `${analysis.single_cjk_tokens} single-character, ` +
    `${analysis.multi_cjk_tokens} multi-character`
  )
}
