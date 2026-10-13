# Other tokenizer families: DeepSeek

`BENCHMARK.md` covers the two OpenAI encodings the shipped tool can run (`o200k_base`, `cl100k_base`).
This page records the same testset measured with **DeepSeek's** tokenizer, which is a different
vocabulary and cannot be reached through `tiktoken`.

Measured 2026-10-12. Not run by CI (see *Why this is manual* below).

## Provenance

| Tokenizer | File | sha256 | vocab |
|---|---|---|---|
| DeepSeek-V3 | [`deepseek-ai/DeepSeek-V3/tokenizer.json`](https://huggingface.co/deepseek-ai/DeepSeek-V3/resolve/main/tokenizer.json) | `621ac2e32d0dba658404412318818aaa8ce8cda492e59830109d8da6b517fb41` | 128,815 |
| DeepSeek-V4-Pro | [`deepseek-ai/DeepSeek-V4-Pro/tokenizer.json`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/tokenizer.json) | `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf` | 129,280 |
| DeepSeek-V4.1-Flash | [`deepseek-ai/DeepSeek-V4.1-Flash/tokenizer.json`](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/resolve/main/tokenizer.json) | `c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b` | 129,280 |

All three produced **identical** counts, so one result row covers them.

## Result

Same 6 items x 4 scripts as `BENCHMARK.md` (`en` / `zh_s` / `zh_t` / `yue`), `add_special_tokens=False`:

| Tokenizer | English | 简体 | 繁體 | 粵語 | 繁/简 | 粤/简 | 粤/英 | 简/英 |
|---|---|---|---|---|---|---|---|---|
| **DeepSeek V3 / V4 / V4.1** | 83 | **64** | 82 | 82 | 1.28x | 1.28x | **0.99x** | **0.77x** |
| `o200k_base` | 83 | 83 | 98 | 103 | 1.18x | 1.24x | 1.24x | 1.00x |
| `cl100k_base` | 84 | 128 | 149 | 150 | 1.16x | 1.17x | 1.79x | 1.52x |

Three observations:

1. **简体 is cheaper than English on DeepSeek** (64 vs 83, −23%). On `o200k_base` 简体 only ties English.
2. **繁體 and 粵語 cost about the same as English** (82 vs 83). On `o200k_base` 粵語 is +24% over English.
3. The mechanism is the same as everywhere else - **half-characters**: 简体 0/64 (0.0%), 繁體 10/82 (12.2%),
   粵語 8/82 (9.8%). DeepSeek's vocabulary covers simplified Chinese completely and still splits some
   traditional characters.

## V3 -> V4: the tokenizer was inherited, not retrained

This is the more useful finding for anyone budgeting DeepSeek token costs.

| Fact | Measurement |
|---|---|
| Tokens V4 adds over V3 | exactly **465** |
| What they are | 415 multimodal placeholders (`<\|place_holder_mm_span_XXXX\|>`), 46 tool/edit markup tags (`<｜begin▁of▁file｜>`, `｜DSML｜`, `<｜place▁holder▁for▁copy｜>`), 4 ASCII control tags (`<think>`, `</think>`, `<dsml:`, `</dsml:`) |
| Shared pieces that kept their id | **128,815 / 128,815** - every V3 token keeps its exact id |
| Testset rows tokenizing to the same id sequence | **24 / 24** |

Because V3's vocabulary is a strict subset of V4's with unchanged ids, texts that do not contain the
new markup tokenize **identically** on V3, V4-Pro and V4.1-Flash. That is a structural property, not a
coincidence of this testset.

Practical consequence: **migrating V3 -> V4 does not change your per-token bill.** The 465 new tokens
are for multimodality and tooling, not language coverage.

## Reproduce

```bash
pip install tokenizers
curl -o ds.json https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/tokenizer.json
python bench/hf_tokenizer_stats.py ds.json --label DeepSeek-V4-Pro
```

The script prints the file's sha256 and vocab size, the per-item matrix, the totals against
`baseline.json`, the partial-character counts and a round-trip check. Verify the sha256 against the
table above before quoting a number.

For the V3-vs-V4 comparison (`465 new tokens`, `all ids unchanged`), the one-off script used is not
kept in the repo - it is three lines of set difference over `Tokenizer.get_vocab()`. Pin the two
sha256 values above and it is reproducible.

## Why this is manual

Downloading a 6 MB `tokenizer.json` from `resolve/main` in CI would make the build depend on a moving
URL, and would add `tokenizers` to the CI install for a check that guards nothing the shipped package
does. The tool ships with `tiktoken` only; local-model tokenizers are a v2 item (see README roadmap).

## Limits

- 6 items x 4 scripts. Same scope as `BENCHMARK.md`; ratios are not universal constants.
- The `partial` definition here is the same *intent* as `BENCHMARK.md` (a token whose bytes are not a
  whole UTF-8 character) but not the same implementation: `tokenizers` exposes no per-token byte view,
  so a replacement character on single-token decode is used as the signal. Treat partial counts as a
  close approximation, and the token counts as exact (round-trip is 24/24).
- **Tokenizer is not model quality.** These numbers say nothing about how well any DeepSeek model
  writes or understands Cantonese. Equal token counts across V3/V4 does not mean equal output.
