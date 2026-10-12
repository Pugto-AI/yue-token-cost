# yue-token-cost

**Measure what Chinese/Cantonese actually costs in tokens — and why.**

MCP server + DSH plugin. No GPU, no data, no model training: deterministic text measurement only.

> Status: **v0.1.0, implemented and verified locally.** 18 tests + 9 stdio smoke checks + a
> Node-vs-Python benchmark cross-check (48 rows) all pass; the DSH bundle composes in an isolated
> profile. Not yet published to npm.

## Why

Same meaning, different scripts, very different bills. Measured over the 6-item HK labour/legal testset in [`BENCHMARK.md`](./BENCHMARK.md):

| Tokenizer | English | 简体 | 繁體 | 粵語 |
|---|---|---|---|---|
| `o200k_base` (GPT-4o+) | 83 | 83 | **98** | **103** |
| `cl100k_base` (GPT-4 era) | 84 | **128** | **149** | **150** |

Two things this makes visible, neither of which a plain token counter tells you:

1. **繁體/粵語 still cost 18–24% more than 简体** on modern tokenizers — and on the older one, Chinese as a whole costs **+52% (简) to +79% (粤)** vs English.
2. **Switching tokenizer generation beats rewriting your text**: the same 简体 text drops **128 → 83 tokens (−35%)** from `cl100k` to `o200k`.

Existing tools count one string with one tokenizer. They do not compare scripts, and they do not explain *why* the extra tokens exist. This one does.

## Install

Generic MCP client (Cursor / Claude Code / VS Code / any stdio MCP host):

```jsonc
{ "mcpServers": { "yue-token-cost": { "command": "npx", "args": ["-y", "yue-token-cost"] } } }
```

DSH (config-only bundle; the server itself is the same npm package):

```bash
dsh plugin add yue-token-cost
# then: mcp__yue-token-cost__count_tokens
```

If `npx` is unavailable (offline machine, or a pinned checkout), point the client at the entry
file instead: `{ "command": "node", "args": ["/abs/path/to/yue-token-cost/server.mjs"] }`.

## Develop

```bash
pnpm install
npm test              # 18 unit + contract tests, no network
npm run smoke         # drives server.mjs over real stdio with the official MCP client
npm run bench         # Node results vs the Python baseline (cross-runtime check)
```

Python side of the benchmark (development/CI only - never needed to *use* the tool):

```bash
pip install tiktoken==0.14.0
python bench/generate_benchmark.py   # rewrites BENCHMARK.md
python bench/make_baseline.py        # rewrites bench/baseline.json
```

## Tools

| Tool | Input | Output |
|---|---|---|
| `count_tokens` | `text`, `tokenizer?`, `usd_per_million?` | tokens / chars / bytes, and cost if a rate is given |
| `compare_scripts` | `texts[]` (same meaning, different scripts), `tokenizers[]?` | side-by-side counts + delta + **attribution** |
| `explain_split` | `text`, `tokenizer?` | per-token breakdown, flagging half-characters, digit splits, leading-space variants |

Example (`explain_split` on `饿`):

```json
{ "text": "饿", "tokenizer": "o200k_base", "tokens": 2,
  "pieces": [{ "id": 165, "bytes": "e9", "partial": true }, { "id": 12297, "bytes": "a5bf", "partial": true }] }
```

Schemas: [`docs/tool-schemas.json`](./docs/tool-schemas.json).

## Non-goals (v1)

No Jyutping (already covered by [`tinci-mcp`](https://github.com/liyb-gz/tinci-mcp) — depend on `tojyutping` if needed), no dictionary, no ASR, no model training, no web UI, no "auto-rewrite to save tokens".

## Benchmark

[`BENCHMARK.md`](./BENCHMARK.md) is generated, not hand-written:

```bash
pip install tiktoken && python bench/generate_benchmark.py
```

Every number in the README comes from that file. Scope and honesty notes (which tokenizers are covered, why ratios are not universal constants, why identical 简体/繁體 items are kept) are at the bottom of it.

## Roadmap

- **v1** — 3 tools above, `o200k_base` + `cl100k_base`, npm + DSH bundle, tests, generated benchmark.
- **v2** — local-model tokenizers as separate rows (`hf:<repo>`), glossary-aware "cheaper equivalent wording" suggestions.
- **v3** — optional `cantonese_asr` (local `whisper-small-cantonese`) — the first thing here that needs a GPU.

## License

MIT.
