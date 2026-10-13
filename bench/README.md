# bench/

The numbers in `../BENCHMARK.md` are a published contract: they are quoted in the README and by
anyone who copies them. So the benchmark is generated, never hand-edited, and CI fails when it drifts.

| File | Role |
|---|---|
| `testset.json` | Single source of truth for the benchmark texts (6 items × 4 scripts). |
| `generate_benchmark.py` | Python + `tiktoken` → writes `BENCHMARK.md`. Do not rewrite; CI runs it. |
| `make_baseline.py` | Python + `tiktoken` → writes `baseline.json`. `--check` fails on drift. |
| `baseline.json` | The Python numbers, committed. The Node side asserts against this file. |
| `reproduce.mjs` | Node + `js-tiktoken` → asserts every row equals `baseline.json`. |
| `vocab_stats.py` | Vocabulary composition of `o200k_base` (105,898 English word pieces vs 7,532 Chinese-containing tokens) - the numbers the launch posts quote for *why* the gap exists. CI runs it; drift fails loudly. |

Why the baseline comes from Python: the shipped tool is Node, the generator is Python. Two
independent implementations of the same tokenizer are the only real cross-check available; a
baseline produced by the Node code would only test that the code equals itself.

## When CI turns red on the benchmark

1. Read `git diff BENCHMARK.md` and see what actually changed.
2. Decide which of these it is: tokenizer version change, testset edit, or attribution change.
3. If the change is intended, regenerate (`make_baseline.py`, then `generate_benchmark.py`),
   update the numbers quoted in `README.md`, and commit **all three together** — the commit
   message must say why the numbers moved.
4. A `tiktoken` version change must appear in both the commit message and the generation note in
   `BENCHMARK.md`.

Never "fix" CI by loosening the assertion.
