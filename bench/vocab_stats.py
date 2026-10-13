"""Vocabulary composition of o200k_base: the numbers both launch posts quote.

The launch posts claim ~105,898 English word pieces and ~7,532 tokens containing a Chinese
character. Those are the *explanation* for the cost gap, so they must be reproducible too -
BENCHMARK.md only covers token counts.

Definitions (state them, they change the answer):
  english_word_pieces  = token is ASCII letters, optionally preceded by one space
  cjk_tokens           = token decodes strictly as UTF-8 and contains a char in U+4E00-U+9FFF

Usage: python bench/vocab_stats.py
"""
import io
import re
import sys

import tiktoken

# Quoted in docs/launch-post.zh.md and docs/launch-post.en.md. A tokenizer change must fail here.
EXPECTED = {
    "n_vocab": 200019,
    "english_word_pieces": 105898,
    "cjk_tokens": 7532,
}

ENGLISH_RE = re.compile(r" ?[A-Za-z]+")


def decode_strict(raw):
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def main():
    enc = tiktoken.get_encoding("o200k_base")
    # ponytail: _mergeable_ranks is private API; it is the only way to inspect the vocabulary,
    # and the EXPECTED assertions below turn a tokenizer change into a loud failure.
    ranks = enc._mergeable_ranks

    english = cjk = 0
    for raw in ranks:
        text = decode_strict(raw)
        if text is None:
            continue
        if ENGLISH_RE.fullmatch(text):
            english += 1
        if any("\u4e00" <= c <= "\u9fff" for c in text):
            cjk += 1

    got = {
        "n_vocab": enc.n_vocab,
        "english_word_pieces": english,
        "cjk_tokens": cjk,
    }

    for key, expected in EXPECTED.items():
        mark = "ok " if got[key] == expected else "DRIFT"
        print(f"{mark} {key}: {got[key]} (expected {expected})")

    if got != EXPECTED:
        raise SystemExit(
            "vocabulary statistics changed; update EXPECTED here and the two launch posts "
            "(and say which tiktoken version moved the numbers)"
        )

    ratio = got["n_vocab"] / got["cjk_tokens"]
    print(f"\no200k_base: 1 Chinese-containing token per {ratio:.1f} vocabulary entries")


if __name__ == "__main__":
    main()
