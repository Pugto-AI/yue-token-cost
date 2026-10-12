/**
 * Cross-runtime benchmark check: run the *Node* implementation over bench/testset.json and
 * compare every row against bench/baseline.json, which was produced by the *Python* tiktoken
 * implementation (see bench/make_baseline.py).
 *
 * This is the check that catches a js-tiktoken / tiktoken divergence, and it also asserts the
 * byte-offset invariant for every benchmark text.
 *
 * Run: node bench/reproduce.mjs   (exit code 0 = match)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyseText } from '../lib/analyse.mjs'
import { loadEncoder } from '../lib/tokenizers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const readJson = (rel) => JSON.parse(readFileSync(path.join(here, rel), 'utf8'))

/**
 * @returns {Promise<{rows:number, totals:Record<string,Record<string,number>>}>}
 * @throws when any row, total or invariant disagrees with the Python baseline
 */
export async function runBenchmarkChecks({ log = () => {} } = {}) {
  const baseline = readJson('baseline.json')
  const testset = readJson('testset.json')
  const textOf = new Map()
  for (const item of testset.items) {
    for (const script of baseline.scripts) textOf.set(`${item.id}/${script}`, item[script])
  }

  const failures = []
  const totals = {}
  for (const name of baseline.tokenizers) totals[name] = Object.fromEntries(baseline.scripts.map((s) => [s, 0]))
  let rows = 0

  for (const expected of baseline.rows) {
    const key = `${expected.item}/${expected.script}`
    const text = textOf.get(key)
    assert.ok(text !== undefined, `testset is missing ${key}`)

    const encoder = await loadEncoder(expected.tokenizer)
    const a = analyseText(encoder, text)
    rows++

    const where = `${key} [${expected.tokenizer}]`
    if (a.tokens !== expected.tokens) {
      failures.push(`${where}: tokens ${a.tokens} != baseline ${expected.tokens}`)
    }
    if (expected.partial_char_tokens !== undefined) {
      if (a.partial_char_tokens !== expected.partial_char_tokens) {
        failures.push(`${where}: partial ${a.partial_char_tokens} != baseline ${expected.partial_char_tokens}`)
      }
      if (a.single_cjk_tokens !== expected.single_cjk_tokens) {
        failures.push(`${where}: single_cjk ${a.single_cjk_tokens} != baseline ${expected.single_cjk_tokens}`)
      }
      if (a.multi_cjk_tokens !== expected.multi_cjk_tokens) {
        failures.push(`${where}: multi_cjk ${a.multi_cjk_tokens} != baseline ${expected.multi_cjk_tokens}`)
      }
    }

    // Offset invariant: the per-token bytes must reassemble the input exactly.
    const hex = Buffer.from(text, 'utf8').toString('hex')
    if (a.pieces.map((p) => p.bytes).join('') !== hex) {
      failures.push(`${where}: token bytes do not reassemble the input`)
    }
    // Attribution must never exceed the token count.
    if (a.partial_char_tokens + a.single_cjk_tokens + a.multi_cjk_tokens > a.tokens) {
      failures.push(`${where}: attribution exceeds token count`)
    }

    totals[expected.tokenizer][expected.script] += a.tokens
    log(`  ${where}: ${a.tokens} tokens`)
  }

  for (const name of baseline.tokenizers) {
    for (const script of baseline.scripts) {
      const got = totals[name][script]
      const want = baseline.totals[name][script]
      if (got !== want) failures.push(`totals ${name}/${script}: ${got} != baseline ${want}`)
    }
  }

  if (failures.length) {
    throw new Error(`benchmark mismatch (${failures.length}):\n  ${failures.join('\n  ')}`)
  }
  return { rows, totals }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    const { rows, totals } = await runBenchmarkChecks()
    console.log(`benchmark: ${rows} rows match the Python baseline`)
    for (const [name, byScript] of Object.entries(totals)) {
      console.log(`  ${name}: ${Object.entries(byScript).map(([s, n]) => `${s} ${n}`).join(' / ')}`)
    }
  } catch (err) {
    console.error(String(err && err.message ? err.message : err))
    process.exit(1)
  }
}
