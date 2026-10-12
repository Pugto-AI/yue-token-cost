/**
 * Tokenizer loading, per-token raw bytes, and cost estimation.
 *
 * Runtime is Node only: js-tiktoken ships the same rank tables as Python tiktoken,
 * so the numbers here are comparable with bench/generate_benchmark.py (which uses Python).
 * Two independent implementations that must agree - bench/reproduce.mjs is the cross-check.
 */
import { Tiktoken } from 'js-tiktoken/lite'

export const TOKENIZER_NAMES = ['o200k_base', 'cl100k_base']

const RANK_LOADERS = {
  o200k_base: () => import('js-tiktoken/ranks/o200k_base'),
  cl100k_base: () => import('js-tiktoken/ranks/cl100k_base'),
}

const encoders = new Map()

/**
 * Load (and cache) an encoder. Rank tables are imported on demand: each is ~2.3 MB.
 * @param {'o200k_base'|'cl100k_base'} name
 * @returns {Promise<Tiktoken>}
 */
export async function loadEncoder(name) {
  const loader = RANK_LOADERS[name]
  if (!loader) throw new Error(`unknown tokenizer: ${name}`)
  if (!encoders.has(name)) {
    const mod = await loader()
    encoders.set(name, new Tiktoken(mod.default))
  }
  return encoders.get(name)
}

/**
 * The raw bytes of a single token. For a partial character this returns the real bytes
 * (e.g. 0xe9), never a U+FFFD replacement character.
 *
 * ponytail: js-tiktoken's `textMap` is undeclared in its .d.ts but is the only per-token byte
 * source. If it disappears upstream, the fallback below is used **only** when it round-trips
 * losslessly; otherwise this throws instead of reporting a wrong number.
 * @param {Tiktoken} encoder
 * @param {number} id
 * @returns {Buffer}
 */
export function rawTokenBytes(encoder, id) {
  const direct = encoder.textMap && encoder.textMap.get(id)
  if (direct !== undefined) return Buffer.from(direct)

  const decoded = encoder.decode([id])
  let lossless = false
  try {
    const roundTrip = encoder.encode(decoded)
    lossless = roundTrip.length === 1 && roundTrip[0] === id
  } catch {
    lossless = false
  }
  if (!lossless) {
    throw new Error(
      `no raw bytes available for token id ${id}: js-tiktoken's textMap is gone and decode() is lossy for this token`,
    )
  }
  return Buffer.from(decoded, 'utf8')
}

/**
 * Turn a token count into a cost estimate. No price table is bundled: prices change,
 * so the caller supplies the rate. Not rounded - callers want the raw number.
 * @param {number} tokens
 * @param {number|undefined} usdPerMillion
 * @returns {number|null}
 */
export function estimateUsd(tokens, usdPerMillion) {
  if (usdPerMillion === undefined) return null
  return (tokens / 1_000_000) * usdPerMillion
}
