/**
 * The three tools: input schemas (Zod, .strict() so undeclared fields are rejected)
 * and their implementations. Schemas here are the source of truth; docs/tool-schemas.json
 * is the frozen contract they are compared against in tests.
 */
import { z } from 'zod'
import { TOKENIZER_NAMES, estimateUsd, loadEncoder } from './tokenizers.mjs'
import { analyseText, explainRow } from './analyse.mjs'
import { ValidationError, mapEncoderError } from './errors.mjs'

const tokenizerEnum = z.enum(['o200k_base', 'cl100k_base'])

export const countTokensSchema = z
  .object({
    text: z.string(),
    tokenizer: tokenizerEnum.default('o200k_base'),
    usd_per_million: z.number().finite().nonnegative().optional(),
  })
  .strict()

export const compareScriptsSchema = z
  .object({
    texts: z
      .array(z.object({ label: z.string(), text: z.string() }).strict())
      .min(2),
    tokenizers: z.array(tokenizerEnum).min(1).default(['o200k_base']),
  })
  .strict()

export const explainSplitSchema = z
  .object({
    text: z.string(),
    tokenizer: tokenizerEnum.default('o200k_base'),
  })
  .strict()

const pieceSchema = z
  .object({
    index: z.number().int(),
    id: z.number().int(),
    bytes: z.string(),
    decoded: z.string(),
    partial: z.boolean(),
  })
  .strict()

export const countTokensOutputSchema = z
  .object({
    tokenizer: z.string(),
    tokens: z.number().int(),
    chars: z.number().int(),
    bytes: z.number().int(),
    usd_estimate: z.number().nullable(),
  })
  .strict()

const rowSchema = z
  .object({
    label: z.string(),
    tokens: z.number().int(),
    chars: z.number().int(),
    bytes: z.number().int(),
    delta_vs_cheapest_pct: z.number(),
    partial_char_tokens: z.number().int(),
    single_cjk_tokens: z.number().int(),
    multi_cjk_tokens: z.number().int(),
    explanation: z.string(),
  })
  .strict()

export const compareScriptsOutputSchema = z
  .object({
    results: z.array(
      z
        .object({
          tokenizer: z.string(),
          rows: z.array(rowSchema),
        })
        .strict(),
    ),
  })
  .strict()

export const explainSplitOutputSchema = z
  .object({
    tokenizer: z.string(),
    tokens: z.number().int(),
    pieces: z.array(pieceSchema),
  })
  .strict()

async function analyse(encoderName, text) {
  const encoder = await loadEncoder(encoderName)
  try {
    return analyseText(encoder, text)
  } catch (err) {
    throw mapEncoderError(err, text)
  }
}

/** @param {{text:string,tokenizer?:string,usd_per_million?:number}} args */
export async function countTokens(args) {
  const tokenizer = args.tokenizer ?? TOKENIZER_NAMES[0]
  const a = await analyse(tokenizer, args.text)
  return {
    tokenizer,
    tokens: a.tokens,
    chars: a.chars,
    bytes: a.bytes,
    usd_estimate: estimateUsd(a.tokens, args.usd_per_million),
  }
}

/** @param {{texts:{label:string,text:string}[],tokenizers?:string[]}} args */
export async function compareScripts(args) {
  const tokenizers = args.tokenizers ?? [TOKENIZER_NAMES[0]]

  const labels = args.texts.map((t) => t.label)
  if (new Set(labels).size !== labels.length) {
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
    throw new ValidationError(`duplicate label: ${[...new Set(dupes)].join(', ')}`)
  }
  if (new Set(tokenizers).size !== tokenizers.length) {
    throw new ValidationError(`duplicate tokenizer: ${[...new Set(tokenizers)].join(', ')}`)
  }

  const results = []
  for (const tokenizer of tokenizers) {
    const analyses = await Promise.all(args.texts.map((t) => analyse(tokenizer, t.text)))
    const cheapest = Math.min(...analyses.map((a) => a.tokens))
    results.push({
      tokenizer,
      rows: analyses.map((a, i) => ({
        label: args.texts[i].label,
        tokens: a.tokens,
        chars: a.chars,
        bytes: a.bytes,
        delta_vs_cheapest_pct: Math.round((a.tokens / cheapest - 1) * 1000) / 10,
        partial_char_tokens: a.partial_char_tokens,
        single_cjk_tokens: a.single_cjk_tokens,
        multi_cjk_tokens: a.multi_cjk_tokens,
        explanation: explainRow(a, cheapest),
      })),
    })
  }
  return { results }
}

/** @param {{text:string,tokenizer?:string}} args */
export async function explainSplit(args) {
  const tokenizer = args.tokenizer ?? TOKENIZER_NAMES[0]
  const a = await analyse(tokenizer, args.text)
  return { tokenizer, tokens: a.tokens, pieces: a.pieces }
}
