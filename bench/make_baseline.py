"""Produce bench/baseline.json from the *Python* tiktoken implementation.

Why: the shipped tool is Node (js-tiktoken), the benchmark generator is Python (tiktoken).
Two independent implementations of the same tokenizer are the only real cross-check we have,
so the baseline must come from the Python side - never from the Node side, or the check is circular.

Usage:
  python bench/make_baseline.py           # write bench/baseline.json
  python bench/make_baseline.py --check   # fail if the committed file differs from a fresh run
"""
import io
import json
import os
import sys

import tiktoken

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPTS = ["en", "zh_s", "zh_t", "yue"]
TOKENIZERS = ["o200k_base", "cl100k_base"]

# Totals that BENCHMARK.md advertises (README quotes them). Kept here so a drifted
# baseline cannot silently disagree with the published benchmark.
EXPECTED_TOTALS = {
    "o200k_base": {"en": 83, "zh_s": 83, "zh_t": 98, "yue": 103},
    "cl100k_base": {"en": 84, "zh_s": 128, "zh_t": 149, "yue": 150},
}
EXPECTED_PARTIAL_O200K = {"en": 0, "zh_s": 10, "zh_t": 14, "yue": 24}


def attribution(enc, text):
    partial = single = multi = 0
    for tok in enc.encode(text):
        raw = enc.decode_single_token_bytes(tok)
        try:
            s = raw.decode("utf-8")
        except UnicodeDecodeError:
            partial += 1
            continue
        if len(s) == 1 and "\u4e00" <= s <= "\u9fff":
            single += 1
        elif len(s) >= 2 and all("\u4e00" <= c <= "\u9fff" for c in s):
            multi += 1
    return partial, single, multi


def build():
    with io.open(os.path.join(HERE, "testset.json"), encoding="utf-8") as f:
        ts = json.load(f)

    encs = {name: tiktoken.get_encoding(name) for name in TOKENIZERS}
    rows = []
    totals = {name: {s: 0 for s in SCRIPTS} for name in TOKENIZERS}
    partial_totals = {s: 0 for s in SCRIPTS}

    for item in ts["items"]:
        for script in SCRIPTS:
            text = item[script]
            for name in TOKENIZERS:
                enc = encs[name]
                row = {
                    "item": item["id"],
                    "script": script,
                    "tokenizer": name,
                    "tokens": len(enc.encode(text)),
                }
                if name == "o200k_base":
                    p, s, m = attribution(enc, text)
                    row.update(
                        partial_char_tokens=p, single_cjk_tokens=s, multi_cjk_tokens=m
                    )
                    partial_totals[script] += p
                rows.append(row)
                totals[name][script] += row["tokens"]

    for name, expected in EXPECTED_TOTALS.items():
        if totals[name] != expected:
            raise SystemExit(f"totals drifted for {name}: {totals[name]} != {expected}")
    if partial_totals != EXPECTED_PARTIAL_O200K:
        raise SystemExit(f"o200k partial totals drifted: {partial_totals} != {EXPECTED_PARTIAL_O200K}")

    return {
        "generated_by": "bench/make_baseline.py",
        "tiktoken": tiktoken.__version__,
        "testset": "bench/testset.json",
        "scripts": SCRIPTS,
        "tokenizers": TOKENIZERS,
        "rows": rows,
        "totals": totals,
        "partial_totals_o200k": partial_totals,
    }


def main():
    data = build()
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    out = os.path.join(HERE, "baseline.json")

    if "--check" in sys.argv:
        if not os.path.exists(out):
            raise SystemExit("bench/baseline.json is missing; run without --check to create it")
        with io.open(out, encoding="utf-8") as f:
            committed = f.read()
        if committed != payload:
            raise SystemExit(
                "bench/baseline.json is out of date (Python tiktoken no longer produces it). "
                "Review the diff, then regenerate and update BENCHMARK.md / README in the same commit."
            )
        print("baseline.json matches a fresh Python run")
        return

    with io.open(out, "w", encoding="utf-8") as f:
        f.write(payload)
    print(f"wrote {out}")
    print("totals:", data["totals"])
    print("o200k partial totals:", data["partial_totals_o200k"])


if __name__ == "__main__":
    main()
