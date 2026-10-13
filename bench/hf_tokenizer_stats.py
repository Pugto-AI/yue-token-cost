"""Tokenize the benchmark testset with an arbitrary HuggingFace tokenizer.json.

Not part of the shipped package and not run by CI: it needs the `tokenizers` package and a
tokenizer.json that lives outside this repo (downloading it on every CI run would make the build
depend on a moving `resolve/main` URL). It prints the file's sha256 and vocab size so a number can
be pinned to an exact artifact - record those next to any figure you publish.

Usage:
    pip install tokenizers
    python bench/hf_tokenizer_stats.py <tokenizer.json> [--label NAME]

Example (DeepSeek V4):
    curl -o /tmp/ds.json https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/tokenizer.json
    python bench/hf_tokenizer_stats.py /tmp/ds.json --label DeepSeek-V4-Pro
"""
import argparse
import hashlib
import io
import json
import os
import sys

from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["en", "zh_s", "zh_t", "yue"]
LABELS = {"en": "English", "zh_s": "简体", "zh_t": "繁體", "yue": "粵語"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tokenizer")
    ap.add_argument("--label", default=None)
    args = ap.parse_args()

    with io.open(args.tokenizer, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    tok = Tokenizer.from_file(args.tokenizer)
    label = args.label or os.path.basename(args.tokenizer)

    with io.open(os.path.join(HERE, "testset.json"), encoding="utf-8") as f:
        ts = json.load(f)
    with io.open(os.path.join(HERE, "baseline.json"), encoding="utf-8") as f:
        baseline = json.load(f)

    print(f"# {label}")
    print(f"sha256: {digest}")
    print(f"vocab:  {tok.get_vocab_size()} ({type(tok.model).__name__})")
    print()

    rows = {}
    for item in ts["items"]:
        rows[item["id"]] = {}
        for s in SCRIPTS:
            ids = tok.encode(item[s], add_special_tokens=False).ids
            # Same definition as BENCHMARK.md: a token whose bytes are not a whole UTF-8 character
            # decodes on its own to a replacement character.
            partial = sum(
                1
                for i in ids
                if (lambda p: p == "" or "\ufffd" in p)(tok.decode([i], skip_special_tokens=False))
            )
            rows[item["id"]][s] = (len(ids), partial)

    print("| Item | " + " | ".join(LABELS[s] for s in SCRIPTS) + " |")
    print("|" + "---|" * (len(SCRIPTS) + 1))
    for item in ts["items"]:
        r = rows[item["id"]]
        print(f"| {item['label']} | " + " | ".join(str(r[s][0]) for s in SCRIPTS) + " |")

    tot = {s: sum(rows[i["id"]][s][0] for i in ts["items"]) for s in SCRIPTS}
    part = {s: sum(rows[i["id"]][s][1] for i in ts["items"]) for s in SCRIPTS}

    print()
    print("| Tokenizer | English | 简体 | 繁體 | 粵語 | 繁/简 | 粤/简 | 粤/英 | 简/英 |")
    print("|---|---|---|---|---|---|---|---|---|")
    print(
        f"| **{label}** | {tot['en']} | {tot['zh_s']} | {tot['zh_t']} | {tot['yue']} | "
        f"{tot['zh_t']/tot['zh_s']:.2f}x | {tot['yue']/tot['zh_s']:.2f}x | "
        f"{tot['yue']/tot['en']:.2f}x | {tot['zh_s']/tot['en']:.2f}x |"
    )
    for name in baseline["tokenizers"]:
        t = baseline["totals"][name]
        print(
            f"| `{name}` | {t['en']} | {t['zh_s']} | {t['zh_t']} | {t['yue']} | "
            f"{t['zh_t']/t['zh_s']:.2f}x | {t['yue']/t['zh_s']:.2f}x | "
            f"{t['yue']/t['en']:.2f}x | {t['zh_s']/t['en']:.2f}x |"
        )

    print()
    for s in SCRIPTS:
        pct = part[s] / tot[s] * 100 if tot[s] else 0
        print(f"partial-character tokens, {LABELS[s]}: {part[s]}/{tot[s]} ({pct:.1f}%)")

    mismatch = sum(
        1
        for item in ts["items"]
        for s in SCRIPTS
        if tok.decode(tok.encode(item[s], add_special_tokens=False).ids, skip_special_tokens=False)
        != item[s]
    )
    print(f"round-trip: {24 - mismatch}/24 texts decode back identically")
    return 0 if mismatch == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
