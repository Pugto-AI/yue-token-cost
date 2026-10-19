# yue-token-cost

**English** | [中文](./README.zh.md)

**Measure what Chinese/Cantonese actually costs in tokens — and why.**

MCP server + DSH plugin. No GPU, no data, no model training: deterministic text measurement only.

> Status: **v0.1.0, published to npm.** `npx -y yue-token-cost` works today; 18 tests + 9 stdio
> smoke checks + a Node-vs-Python benchmark cross-check (48 rows) pass, and DSH's own MCP client
> spawns the published package and completes all three tools (4/4).

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

Before the first npm release, install straight from GitHub (no registry needed):

```bash
npx -y --allow-git=all github:Pugto-AI/yue-token-cost
```

Some npm configurations block git dependencies by default; `--allow-git=all` lifts that.

## Verified

Every claim here is checkable. What has actually been run, and how:

| Check | Command | What it proves |
|---|---|---|
| Unit + contract tests | `npm test` | 18 tests: attribution boundaries (half-character, digit splitting, leading space), schema strictness, determinism |
| End-to-end over stdio | `npm run smoke` | 9 checks driving `server.mjs` with the official MCP client: tool list, strict-schema rejection, `structuredContent` mirroring |
| Benchmark contract | `npm run bench` | 48 rows match the Python `tiktoken` baseline row by row - Node and Python are two independent implementations |
| Vocabulary numbers | `python bench/vocab_stats.py` | 200,019 / 105,898 / 7,532 - the figures the launch posts quote for *why* the gap exists |
| DSH's own MCP client | `node scripts/dsh-e2e.mjs --target npm` (needs `DSH_CHECKOUT`) | DSH's stdio transport factory spawns the server through `npx` and completes all three tools (4/4) |
| Packed tarball | `npm pack`, then `dsh plugin add <tgz>` in an isolated `DSH_HOME` | The published file set is complete: the bundle composes `mcp-client(serverName: yue-token-cost)` |
| The published package | `npx -y yue-token-cost --version` | Registry install works: exit 0, stdout empty, `0.1.0` on stderr |

CI runs the first four on every push (two jobs, Node 22).

Two npm details worth knowing: the registry also carries a `0.0.0-stage` entry — that is npm's
name-reservation placeholder for staged publishing, not a failed release; `latest` points at `0.1.0`. A first
publish of a new name goes through that staging flow and becomes live a few seconds later.

## Develop

Needs Node ≥ 22 to install with pnpm 11 (pnpm itself imports `node:sqlite`); the published
package declares and supports Node ≥ 20 at runtime.

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

Other tokenizer families are measured separately: [`docs/deepseek-tokenizer.md`](./docs/deepseek-tokenizer.md) — the same testset on DeepSeek V3/V4, and why V3→V4 does not change your per-token bill.

## Roadmap

- **v1** — 3 tools above, `o200k_base` + `cl100k_base`, npm + DSH bundle, tests, generated benchmark.
- **v2** — local-model tokenizers as separate rows (`hf:<repo>`), glossary-aware "cheaper equivalent wording" suggestions.
- **v3** — optional `cantonese_asr` (local `whisper-small-cantonese`) — the first thing here that needs a GPU.

## License

MIT.
