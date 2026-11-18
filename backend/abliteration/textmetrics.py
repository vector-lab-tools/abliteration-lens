# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Measures on generated text.

Ported from LLMbench (GPL-3.0-or-later):
- PATTERNS: src/lib/grammar/patterns.ts, DEFAULT_PATTERNS (lines 55-242). Each
  pattern's regexes are joined with | and matched case-insensitively, without
  overlap, as countMatches (line 249) does.
- STANCE: src/components/viz/ToneView.tsx, lines 10-71 (LLMbench's tone word lists). A word is cleaned with
  [^a-zA-Z'-], lower-cased, and counted in the first category that holds it, in the
  order hedging, boosters, limiting, attitude, intensifiers, self-mentions,
  engagement (lines 356-367).
- Perplexity is 2 to the mean surprisal in bits (src/lib/metrics/uncertainty.ts:25).

Written here (LLMbench has no equivalent): distinct-n, the repetition rate, and the
word-level edit and bigram distances used for the control band.
"""
from __future__ import annotations

import difflib
import math
import re
from typing import Any, Dict, List, Sequence

PATTERNS: List[Dict[str, Any]] = [
    {"id": "not-x-but-y", "label": "Not X but Y (antithesis)", "category": "antithesis",
     "regexes": [r"\bnot\s+(?!just\b|merely\b|only\b|simply\b)[^,.;:!?]{1,80}?\s+but\s+(?:rather\s+|instead\s+)?"]},
    {"id": "not-just-x-but-y", "label": "Not just X but Y (intensified antithesis)", "category": "antithesis",
     "regexes": [r"\bnot\s+(?:just|merely|only|simply)\s+[^,.;:!?]{1,120}?\s+but\s+(?:rather\s+|also\s+|instead\s+)?"]},
    {"id": "it-is-not-x-it-is-y", "label": "It's not X, it's Y (false correction)", "category": "antithesis",
     "regexes": [r"\b(?:it['’]s|it\s+is|this\s+isn['’]t|this\s+is\s+not)\s+(?:that\s+)?[^,.;:!?]{1,80}[,;.—–-]+\s*(?:it['’]s|it\s+is)\s+"]},
    {"id": "while-x-y", "label": "While X, Y (conciliation pivot)", "category": "antithesis",
     "regexes": [r"\b(?:while|although|though)\s+[^,.;:!?]{1,120}?,\s+"]},
    {"id": "what-matters-is-not-x-but-y", "label": "What matters is not X but Y (cleft emphasis)",
     "category": "antithesis",
     "regexes": [r"\b(?:what\s+(?:matters|counts|(?:is\s+)?(?:important|really\s+at\s+stake)))\s+(?:is\s+)?not\s+[^,.;:!?]{1,120}?\s+but\s+(?:rather\s+|instead\s+)?"]},
    {"id": "hedging-triplet", "label": "Hedging triplet", "category": "hedging",
     "regexes": [r"\b(?:perhaps|possibly|presumably|arguably)\b",
                 r"\b(?:may|might|could|would)\s+(?:be|have|well|also|still)\b",
                 r"\b(?:seems|appears|suggests|indicates|tends)\s+to\b",
                 r"\b(?:it\s+(?:is|seems)\s+(?:possible|likely|probable|reasonable)\s+that)\b"]},
    {"id": "tricolon", "label": "Tricolon / parallelism", "category": "parallelism",
     "regexes": [r"\b(?:\w[\w\s'-]{1,40}),\s+(?:\w[\w\s'-]{1,40}),\s+and\s+(?:\w[\w\s'-]{1,40})\b",
                 r"\bnot\s+\w[\w\s-]{0,30},\s+not\s+\w[\w\s-]{0,30},\s+(?:and\s+)?not\s+",
                 r"\b(?:it\s+is\s+\w[\w\s-]{1,30}[.;]\s+){2}it\s+is\s+"]},
    {"id": "modal-stack", "label": "Modal stacking", "category": "modality",
     "regexes": [r"\b(?:can|will|should|must|could|would|might|may|shall)\b[\w\s,'-]{1,40}\b(?:can|will|should|must|could|would|might|may|shall)\b"]},
]
_COMPILED = {p["id"]: re.compile("|".join(f"(?:{r})" for r in p["regexes"]), re.I) for p in PATTERNS}


def pattern_hits(text: str) -> Dict[str, int]:
    return {pid: sum(1 for m in rx.finditer(text) if m.end() > m.start()) for pid, rx in _COMPILED.items()}


def pattern_spans(text: str, pid: str) -> List[List[int]]:
    return [[m.start(), m.end()] for m in _COMPILED[pid].finditer(text) if m.end() > m.start()][:50]


# Stance words: word lists for hedges, boosters, negation, evaluation, intensifiers, self-mentions
# and engagement. Plain lists of words, counted; not a model of any one author's categories.
STANCE = [
    ("hedging", "Hedges", "might may could perhaps possibly probably likely arguably seems seem appear appears "
     "seemingly apparently suggest suggests indicate indicates somewhat rather relatively generally often "
     "sometimes tend tends usually typically approximately roughly partially essentially virtually presumably "
     "supposedly allegedly conceivably potentially theoretically"),
    ("confident", "Boosters", "clearly obviously certainly definitely undoubtedly absolutely always must will shall "
     "inevitably unquestionably indisputably evidently plainly surely necessarily demonstrably explicitly "
     "precisely exactly directly conclusively"),
    ("negation", "Negation", "not no never neither nor without hardly barely rarely seldom nothing nobody nowhere "
     "none scarcely lack lacks lacking absent fail fails impossible unable cannot can't won't don't doesn't "
     "isn't aren't wasn't weren't haven't hasn't hadn't"),
    ("evaluative", "Evaluative", "important crucial fundamental essential critical necessary key central vital "
     "significant decisive valuable useful effective powerful compelling remarkable striking notable profound "
     "interesting fascinating problematic concerning troubling controversial questionable inadequate "
     "insufficient flawed challenging complex limited surprising unexpected curious unfortunate regrettable"),
    ("intensifiers", "Intensifiers", "very extremely highly deeply greatly profoundly exceptionally especially "
     "particularly considerably substantially enormously tremendously thoroughly entirely utterly wholly "
     "strongly immensely vastly"),
    ("self_mentions", "Self-mentions", "i we my our me us myself ourselves"),
    ("engagement", "Engagement", "you your yourself consider note notice observe imagine see recall remember think "
     "suppose ask question wonder examine look compare"),
]
_ST = [(k, label, set(words.split())) for k, label, words in STANCE]


def stance(text: str) -> Dict[str, int]:
    counts = {k: 0 for k, _, _ in _ST}
    for w in re.findall(r"[a-zA-Z'-]+", text):
        w = re.sub(r"[^a-zA-Z'-]", "", w).lower()
        for k, _, s in _ST:
            if w in s:
                counts[k] += 1
                break
    return counts


def words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z0-9'’-]+|[^\sA-Za-z0-9]", text.lower())


def distinct_n(ws: Sequence[str], n: int) -> float:
    grams = [tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)]
    return len(set(grams)) / len(grams) if grams else 0.0


def repetition(ws: Sequence[str], n: int = 3) -> float:
    """Share of word n-grams that occur more than once in the text."""
    grams = [tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)]
    if not grams:
        return 0.0
    c: Dict[tuple, int] = {}
    for g in grams:
        c[g] = c.get(g, 0) + 1
    return sum(1 for g in grams if c[g] > 1) / len(grams)


def edit_distance(a: Sequence[str], b: Sequence[str]) -> float:
    """Word-level Levenshtein distance divided by the longer length (0 identical, 1 nothing shared)."""
    if not a and not b:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1] / max(len(a), len(b))


def bigram_distance(a: Sequence[str], b: Sequence[str]) -> float:
    """1 minus the Jaccard overlap of the two texts' word bigram sets."""
    A = {tuple(a[i:i + 2]) for i in range(len(a) - 1)}
    B = {tuple(b[i:i + 2]) for i in range(len(b) - 1)}
    if not A and not B:
        return 0.0
    return 1 - len(A & B) / len(A | B)


def first_divergence(ta: List[int], tb: List[int]) -> int:
    for i, (x, y) in enumerate(zip(ta, tb)):
        if x != y:
            return i
    return -1 if len(ta) == len(tb) else min(len(ta), len(tb))


def word_diff(a: str, b: str) -> List[List[str]]:
    """Word-level diff as [op, text] with op in common, removed (a only), added (b only).
    LLMbench uses the `diff` package's diffWords (Myers); this uses difflib's matcher on the
    same word-and-space tokens."""
    ta = re.findall(r"\s+|[^\s]+", a)
    tb = re.findall(r"\s+|[^\s]+", b)
    out: List[List[str]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if op == "equal":
            out.append(["common", "".join(ta[i1:i2])])
        else:
            if i2 > i1:
                out.append(["removed", "".join(ta[i1:i2])])
            if j2 > j1:
                out.append(["added", "".join(tb[j1:j2])])
    return out


def surprisal_stats(lps: Sequence[float]) -> Dict[str, float]:
    """From natural-log probabilities: mean surprisal in bits and perplexity (2 to that)."""
    if not lps:
        return {"bits": 0.0, "ppl": 1.0}
    bits = -sum(lps) / len(lps) / math.log(2)
    return {"bits": bits, "ppl": 2 ** bits}


def texture(text: str) -> Dict[str, Any]:
    ws = words(text)
    return {
        "words": len([w for w in ws if re.match(r"[a-z0-9]", w)]),
        "distinct1": distinct_n(ws, 1),
        "distinct2": distinct_n(ws, 2),
        "repetition": repetition(ws, 3),
        "patterns": pattern_hits(text),
        "stance": stance(text),
    }


def distances(base_text: str, bent_text: str, base_ids: List[int], bent_ids: List[int]) -> Dict[str, Any]:
    a, b = words(base_text), words(bent_text)
    return {
        "first_divergence": first_divergence(base_ids, bent_ids),
        "edit": edit_distance(a, b),
        "bigram": bigram_distance(a, b),
    }
