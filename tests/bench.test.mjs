/**
 * The benchmark is a published contract: these numbers are quoted in README.md.
 * The baseline itself comes from the Python implementation (bench/make_baseline.py),
 * so this test is a genuine cross-runtime check rather than a self-fulfilling one.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runBenchmarkChecks } from '../bench/reproduce.mjs'

test('Node results match the Python baseline row by row', async () => {
  const { rows, totals } = await runBenchmarkChecks()
  assert.equal(rows, 48)
  assert.deepEqual(totals.o200k_base, { en: 83, zh_s: 83, zh_t: 98, yue: 103 })
  assert.deepEqual(totals.cl100k_base, { en: 84, zh_s: 128, zh_t: 149, yue: 150 })
})
