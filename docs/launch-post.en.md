# Launch post draft (English)

> For Reddit / Hacker News style channels. Numbers first, tool second - see `distribution.md`.
> Every figure below is in `BENCHMARK.md` and reproducible with `python bench/generate_benchmark.py`.
> Check the tokenizer name is stated: benchmarks differ by tokenizer generation.

---

**Title candidates**

- Chinese costs more tokens than English - here is the measured matrix
- The same sentence costs 24% more in Cantonese than in Simplified Chinese

**Body**

Same meaning, four scripts, two real tokenizers (`o200k_base`, GPT-4o and later; `cl100k_base`,
the GPT-4 era). Six hand-written Hong Kong labour-law enquiries, not machine translation:

| Tokenizer | English | 简体 | 繁體 | 粵語 |
|---|---|---|---|---|
| `o200k_base` | 83 | 83 | **98** | **103** |
| `cl100k_base` | 84 | **128** | **149** | **150** |

Three things worth knowing:

1. **繁體 and 粵語 still cost 18-24% more than 简体** on a modern tokenizer.
2. On the older tokenizer, Chinese as a whole costs **+52% (简体) to +79% (粵語)** against English.
3. **Changing tokenizer generation beats rewriting text**: the same 简体 text goes from 128 to 83
   tokens, a 35% cut.

**Why.** Not "the language is expensive" - it is vocabulary coverage. `o200k_base` holds roughly
**105,898** English word pieces (allowing a leading space) and only **7,532** tokens containing any
Chinese character. Uncovered characters get split: `饿` becomes two tokens (`e9` | `a5bf`), i.e. half
a character each. Colloquial Cantonese words (`咗`, `嘅`, `出糧`) are simply not in the vocabulary,
which is why they cost the most.

**Reproduce it.** 6 sentences x 4 scripts x 2 tokenizers = 48 rows, asserted row by row between two
independent implementations (Python `tiktoken` and Node `js-tiktoken`). Scripts and the generated
table are in the repo.

**The tool.** `yue-token-cost` - a local MCP server: count tokens and cost, compare scripts
side by side, and show exactly how a string splits (flagging half-characters). No network calls, no
telemetry.

```
npx -y --allow-git=all github:Pugto-AI/yue-token-cost
```

It does **not** compare prices - those change. It compares scripts, and explains where the extra
tokens come from.

**Ask.** Drop a prompt you actually use into it and see the difference. If you are counting these
numbers too, or disagree with mine, tell me.

---

## Pre-publish checklist

- [ ] Every number traceable to `BENCHMARK.md`, tokenizer named
- [ ] No adjectives that are not measurements ("huge", "industry-leading")
- [ ] Link the repo, not just the conclusion
- [ ] Record date, channel and response in `distribution.md`
