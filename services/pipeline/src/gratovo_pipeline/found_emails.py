"""Email addresses a creator publishes in their About text and video
descriptions.

Creators write their business address in deliberately awkward forms so that
scrapers miss it, and a person reading the page sees through all of them:

    name@gmail.com            name @ gmail . com
    name (at) gmail (dot) com name [at] gmail [dot] com
    name{at}gmail{dot}com     name at gmail dot com
    and the same with full-width signs (as typed on CJK keyboards)

`find_emails` turns every one of those into the plain address. Pure text in,
list out: no database, no network.

What it refuses, because each looks like an address and is not: ordinary
English with "at" in it (the plain-word form needs " dot " AND a real
top-level domain at the end), retina image names (`logo@2x.png`), and
@handles with no domain after them.
"""

from __future__ import annotations

import re
from typing import Final

# Full-width signs, as typed on CJK keyboards or pasted to dodge scrapers.
_FULL_WIDTH: Final = str.maketrans({chr(0xFF20): "@", chr(0xFF0E): "."})

# "(at)", "[at]", "{at}", "<at>" and the same for "dot", any case, any spacing.
_BRACKETED_AT = re.compile(r"\s*[(\[{<]\s*at\s*[)\]}>]\s*", re.IGNORECASE)
_BRACKETED_DOT = re.compile(r"\s*[(\[{<]\s*dot\s*[)\]}>]\s*", re.IGNORECASE)

# "name at gmail dot com": a word, " at ", then labels joined by " dot ".
_WORD_FORM = re.compile(
    r"(?<![\w.@])([A-Za-z0-9][A-Za-z0-9._%+-]*)\s+at\s+"
    r"([A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z0-9-]+)+)\b",
    re.IGNORECASE,
)

# The address itself. "@" is tight or spaced on BOTH sides: a space before
# it and none after is how a mention is written ("thanks @Scott.Burchell"),
# and handles can carry dots. A dot inside the domain is likewise tight or
# spaced on both sides -- with spaces, never a line break -- so the full stop
# ending a sentence ("...a@b.com. Thanks") is never read as part of it.
_ADDRESS = re.compile(
    r"(?<![A-Za-z0-9._%+-])([A-Za-z0-9][A-Za-z0-9._%+-]*)"
    r"(?:@|[ \t]+@[ \t]+)"
    r"([A-Za-z0-9-]+(?:(?:\.|[ \t]+\.[ \t]+)[A-Za-z0-9-]+)+)"
)

# The plain-word form is the one ordinary prose can imitate ("look at this dot
# product"), so it must end on a top-level domain people actually use for
# business mail, and must not start on a pronoun or a place.
_WORD_FORM_TLDS: Final = frozenset(
    """
    com net org io co ai me tv uk us ca au de fr es it nl be se no dk fi ie ch at
    in pk eg sa ae ma tr br mx ar info biz gg app dev studio media agency email
    live xyz online pro tech digital world global
""".split()
)
_WORD_FORM_STOPWORDS: Final = frozenset(
    """
    me us him her them it this that these those here there home work school out
    back up least all first last once one you we they i look looking
""".split()
)

# Endings that make it a file name or a machine's own address, not a mailbox
# anybody reads.
_NOT_MAILBOXES: Final = frozenset(
    "png jpg jpeg gif webp svg bmp ico mp4 mov avi pdf zip "
    "localdomain localhost local internal lan invalid".split()
)


def _unspell_words(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        local, domain = match.group(1), match.group(2)
        labels = re.split(r"\s+dot\s+", domain, flags=re.IGNORECASE)
        if labels[-1].lower() not in _WORD_FORM_TLDS:
            return match.group(0)
        if local.lower() in _WORD_FORM_STOPWORDS:
            return match.group(0)
        return f"{local}@{'.'.join(labels)}"

    return _WORD_FORM.sub(replace, text)


def _normalise(text: str) -> str:
    text = text.translate(_FULL_WIDTH)
    text = _BRACKETED_AT.sub("@", text)
    text = _BRACKETED_DOT.sub(".", text)
    return _unspell_words(text)


def _unglue(domain: str) -> str:
    """Drops a capitalised word glued on after a real ending with no space,
    as in "jane@gmail.com.Tags: ai" -- the next sentence, not a subdomain."""
    labels = domain.split(".")
    if (
        len(labels) >= 3
        and labels[-1][:1].isupper()
        and labels[-1][1:].islower()
        and labels[-2].islower()
        and labels[-2] in _WORD_FORM_TLDS
    ):
        return ".".join(labels[:-1])
    return domain


def _valid(local: str, domain: str) -> bool:
    if local.endswith(".") or ".." in local:
        return False
    labels = domain.split(".")
    tld = labels[-1]
    if not (2 <= len(tld) <= 24 and tld.isalpha()):
        return False
    if tld in _NOT_MAILBOXES:
        return False
    return all(labels) and not any(label.startswith("-") or label.endswith("-") for label in labels)


def find_emails(*texts: str | None) -> list[str]:
    """Every address in [texts], lower-cased, first seen first, no repeats.
    `None` and empty texts are skipped, so a channel's About text and its
    video descriptions can be passed as they come out of the database."""
    found: list[str] = []
    for text in texts:
        if not text:
            continue
        for match in _ADDRESS.finditer(_normalise(text)):
            local = match.group(1).lower()
            domain = _unglue(re.sub(r"\s+", "", match.group(2))).lower()
            if not _valid(local, domain):
                continue
            address = f"{local}@{domain}"
            if address not in found:
                found.append(address)
    return found
