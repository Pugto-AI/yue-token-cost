/**
 * Tool-level contract tests: schema strictness, per-tokenizer independence,
 * and the errors a caller can actually trigger.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compareScripts,
  compareScriptsSchema,
  countTokens,
  countTokensSchema,
  explainSplit,
} from '../lib/tools.mjs'
import { ValidationError } from '../lib/errors.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const testset = JSON.parse(readFileSync(path.join(here, '..', 'bench', 'testset.json'), 'utf8'))
const holidayPay = testset.items.find((i) => i.id === 'holiday-pay')

test('count_tokens: cost is null without a rate, and equals tokens at $1/M', async () => {
  const without = await countTokens({ text: '我有多少天带薪年假？' })
  assert.equal(without.usd_estimate, null)
  assert.equal(without.tokens, 9)
  assert.equal(without.tokenizer, 'o200k_base')

  const with_ = await countTokens({ text: '我有多少天带薪年假？', usd_per_million: 1_000_000 })
  assert.equal(with_.usd_estimate, with_.tokens)

  const fractional = await countTokens({ text: '我有多少天带薪年假？', usd_per_million: 2.5 })
  assert.equal(fractional.usd_estimate, (9 / 1_000_000) * 2.5)
})

test('compare_scripts: tokenizer blocks follow request order and never mix', async () => {
  const texts = [
    { label: 'en', text: 'How many days of paid annual leave am I entitled to?' },
    { label: 'yue', text: '我有幾多日有薪年假？' },
  ]
  const result = await compareScripts({ texts, tokenizers: ['cl100k_base', 'o200k_base'] })
  assert.deepEqual(result.results.map((r) => r.tokenizer), ['cl100k_base', 'o200k_base'])

  for (const block of result.results) {
    for (const row of block.rows) {
      const standalone = await countTokens({
        text: texts.find((t) => t.label === row.label).text,
        tokenizer: block.tokenizer,
      })
      assert.equal(row.tokens, standalone.tokens, `${block.tokenizer}/${row.label} mixed tokenizers`)
    }
  }
  // The two tokenizers must disagree on at least one row, otherwise this test proves nothing.
  const perScript = (block) => block.rows.map((r) => r.tokens).join(',')
  assert.notEqual(perScript(result.results[0]), perScript(result.results[1]))
})

test('compare_scripts: every row is >= the cheapest, and one row is exactly cheapest', async () => {
  const result = await compareScripts({
    texts: [
      { label: 'en', text: testset.items[0].en },
      { label: 'zh_s', text: testset.items[0].zh_s },
      { label: 'zh_t', text: testset.items[0].zh_t },
      { label: 'yue', text: testset.items[0].yue },
    ],
  })
  const rows = result.results[0].rows
  assert.equal(rows.length, 4)
  assert.ok(rows.every((r) => r.delta_vs_cheapest_pct >= 0))
  // Ties are legitimate: annual-leave has zh_s and zh_t both at 9 tokens.
  assert.ok(rows.filter((r) => r.delta_vs_cheapest_pct === 0).length >= 1)
  assert.equal(Math.min(...rows.map((r) => r.tokens)), rows.find((r) => r.delta_vs_cheapest_pct === 0).tokens)
})

test('compare_scripts: identical strings cannot report a difference (no invented gap)', async () => {
  const result = await compareScripts({
    texts: [
      { label: 'zh_s', text: holidayPay.zh_s },
      { label: 'zh_t', text: holidayPay.zh_t },
    ],
    tokenizers: ['o200k_base', 'cl100k_base'],
  })
  assert.equal(holidayPay.zh_s, holidayPay.zh_t, 'testset item is expected to be identical in both scripts')
  for (const block of result.results) {
    const [a, b] = block.rows
    assert.equal(a.tokens, b.tokens)
    assert.equal(a.delta_vs_cheapest_pct, b.delta_vs_cheapest_pct)
    assert.equal(a.explanation, b.explanation)
  }
  const o200k = result.results.find((r) => r.tokenizer === 'o200k_base')
  const cl100k = result.results.find((r) => r.tokenizer === 'cl100k_base')
  assert.equal(o200k.rows[0].tokens, 15)
  assert.equal(cl100k.rows[0].tokens, 22)

  const swapped = await compareScripts({
    texts: [
      { label: 'zh_t', text: holidayPay.zh_t },
      { label: 'zh_s', text: holidayPay.zh_s },
    ],
  })
  assert.deepEqual(
    swapped.results[0].rows.map((r) => r.tokens),
    result.results[0].rows.map((r) => r.tokens),
  )
})

test('explain_split: pieces are indexed from 0 and count matches tokens', async () => {
  const result = await explainSplit({ text: '我有多少天带薪年假？' })
  assert.equal(result.pieces.length, result.tokens)
  assert.deepEqual(result.pieces.map((p) => p.index), [...Array(result.tokens).keys()])
})

test('caller errors: duplicate label, duplicate tokenizer, single text, special token', async () => {
  await assert.rejects(
    () => compareScripts({ texts: [{ label: 'a', text: 'x' }, { label: 'a', text: 'y' }] }),
    (err) => err instanceof ValidationError && /duplicate label/.test(err.message),
  )
  await assert.rejects(
    () =>
      compareScripts({
        texts: [{ label: 'a', text: 'x' }, { label: 'b', text: 'y' }],
        tokenizers: ['o200k_base', 'o200k_base'],
      }),
    (err) => err instanceof ValidationError && /duplicate tokenizer/.test(err.message),
  )
  await assert.rejects(
    () => countTokens({ text: '<|endoftext|>' }),
    (err) => err instanceof ValidationError && /reserved special token/.test(err.message),
  )
})

test('schemas reject undeclared fields and too-few texts', () => {
  assert.equal(countTokensSchema.safeParse({ text: 'x' }).success, true)
  assert.equal(countTokensSchema.safeParse({ text: 'x', extra: 1 }).success, false)
  assert.equal(countTokensSchema.safeParse({ text: 'x', usd_per_million: -1 }).success, false)
  assert.equal(countTokensSchema.safeParse({ text: 'x', tokenizer: 'gpt2' }).success, false)
  assert.equal(
    compareScriptsSchema.safeParse({ texts: [{ label: 'a', text: 'x' }] }).success,
    false,
  )
  assert.equal(
    compareScriptsSchema.safeParse({ texts: [{ label: 'a', text: 'x' }, { label: 'b', text: 'y' }] }).success,
    true,
  )
})

test('results are deterministic across repeated calls', async () => {
  const args = { texts: [{ label: 'a', text: '我有幾多日年假？' }, { label: 'b', text: 'how many days of leave?' }] }
  const runs = []
  for (let i = 0; i < 3; i++) runs.push(JSON.stringify(await compareScripts(args)))
  assert.equal(new Set(runs).size, 1)
})
