/**
 * Attribution core: the four boundary cases that must not regress.
 * Expectations for ids/bytes come from the plan's appendix B (measured, not guessed).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyseText, deltaVsCheapestPct, explainRow } from '../lib/analyse.mjs'
import { loadEncoder, rawTokenBytes } from '../lib/tokenizers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const testset = JSON.parse(readFileSync(path.join(here, '..', 'bench', 'testset.json'), 'utf8'))

test('half-character: 饿 splits into two partial tokens with real bytes', async () => {
  const enc = await loadEncoder('o200k_base')
  const a = analyseText(enc, '饿')
  assert.equal(a.tokens, 2)
  assert.deepEqual(a.pieces.map((p) => p.bytes), ['e9', 'a5bf'])
  assert.deepEqual(a.pieces.map((p) => p.id), [165, 12297])
  assert.ok(a.pieces.every((p) => p.partial === true))
  assert.deepEqual(a.pieces.map((p) => p.decoded), ['', ''])
  assert.equal(a.partial_char_tokens, 2)
})

test('half-character: 僱 splits too (traditional character)', async () => {
  const enc = await loadEncoder('o200k_base')
  const a = analyseText(enc, '僱')
  assert.equal(a.tokens, 2)
  assert.deepEqual(a.pieces.map((p) => p.bytes), ['e583', 'b1'])
  assert.ok(a.pieces.every((p) => p.partial === true))

  const encOld = await loadEncoder('cl100k_base')
  const b = analyseText(encOld, '僱')
  assert.equal(b.tokens, 2)
  assert.deepEqual(b.pieces.map((p) => p.bytes), ['e583', 'b1'])
  assert.ok(b.pieces.every((p) => p.partial === true))
})

test('a whole Chinese character is not flagged partial', async () => {
  const enc = await loadEncoder('o200k_base')
  const a = analyseText(enc, '我')
  assert.equal(a.tokens, 1)
  assert.equal(a.pieces[0].partial, false)
  assert.equal(a.pieces[0].decoded, '我')
  assert.equal(a.single_cjk_tokens, 1)
  assert.equal(a.partial_char_tokens, 0)
})

test('digits are split, and not counted as Chinese', async () => {
  const enc = await loadEncoder('o200k_base')
  const grouped = analyseText(enc, '1,234,567')
  assert.equal(grouped.tokens, 5)
  assert.deepEqual(grouped.pieces.map((p) => p.decoded), ['1', ',', '234', ',', '567'])
  assert.ok(grouped.pieces.every((p) => p.partial === false))
  assert.equal(grouped.multi_cjk_tokens, 0)

  const plain = analyseText(enc, '1234567')
  assert.equal(plain.tokens, 3)
  assert.notEqual(plain.tokens, grouped.tokens)
})

test('leading space is part of the token, not a separate piece', async () => {
  const enc = await loadEncoder('o200k_base')
  const bare = analyseText(enc, 'hello')
  const spaced = analyseText(enc, ' hello')
  assert.equal(bare.tokens, 1)
  assert.equal(spaced.tokens, 1)
  assert.equal(bare.pieces[0].id, 24912)
  assert.equal(spaced.pieces[0].id, 40617)
  assert.notEqual(bare.pieces[0].id, spaced.pieces[0].id)
  assert.equal(spaced.pieces[0].decoded, ' hello')

  const trailing = analyseText(enc, 'hello ')
  assert.equal(trailing.tokens, 2)
  assert.equal(trailing.pieces[1].decoded, ' ')
})

test('chars counts code points, bytes counts UTF-8 bytes', async () => {
  const enc = await loadEncoder('o200k_base')
  const a = analyseText(enc, '我有多少天带薪年假？')
  assert.equal(a.chars, 10)
  assert.equal(a.bytes, 30)
  assert.equal(a.tokens, 9)
  assert.equal(a.single_cjk_tokens, 7)
  assert.equal(a.multi_cjk_tokens, 1)
  assert.equal(a.partial_char_tokens + a.single_cjk_tokens + a.multi_cjk_tokens, 8)
})

test('attribution never exceeds the token count, and bytes always reassemble', async () => {
  for (const tokenizer of ['o200k_base', 'cl100k_base']) {
    const enc = await loadEncoder(tokenizer)
    for (const item of testset.items) {
      for (const script of ['en', 'zh_s', 'zh_t', 'yue']) {
        const text = item[script]
        const a = analyseText(enc, text)
        assert.ok(
          a.partial_char_tokens + a.single_cjk_tokens + a.multi_cjk_tokens <= a.tokens,
          `${item.id}/${script}: attribution > tokens`,
        )
        assert.equal(
          a.pieces.map((p) => p.bytes).join(''),
          Buffer.from(text, 'utf8').toString('hex'),
          `${item.id}/${script}: bytes do not reassemble`,
        )
      }
    }
  }
})

test('every token id used by the testset has raw bytes available', async () => {
  const enc = await loadEncoder('o200k_base')
  const seen = new Set()
  for (const item of testset.items) {
    for (const script of ['en', 'zh_s', 'zh_t', 'yue']) {
      for (const a of [analyseText(enc, item[script])]) {
        for (const piece of a.pieces) seen.add(piece.id)
      }
    }
  }
  assert.ok(seen.size > 100, `expected a few hundred distinct ids, saw ${seen.size}`)
  for (const id of seen) {
    const bytes = rawTokenBytes(enc, id)
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0, `id ${id} has no bytes`)
    assert.equal(bytes.toString('hex'), Buffer.from(enc.textMap.get(id)).toString('hex'))
  }
})

test('delta and explanation helpers are deterministic', () => {
  assert.equal(deltaVsCheapestPct(98, 83), 18.1)
  assert.equal(deltaVsCheapestPct(83, 83), 0)
  const fake = { tokens: 83, partial_char_tokens: 0, single_cjk_tokens: 10, multi_cjk_tokens: 5 }
  assert.equal(
    explainRow(fake, 83),
    '83 tokens (0% vs cheapest 83): 0 half-character, 10 single-character, 5 multi-character',
  )
})
