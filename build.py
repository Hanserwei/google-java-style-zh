#!/usr/bin/env python3
"""Validate Gemini's translations against the pinned source and build the static site."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent


def source_chunks(source: str) -> list[dict[str, str]]:
    body = BeautifulSoup(source, "html.parser").select_one(".main_body")
    if body is None:
        raise ValueError("Upstream .main_body is missing")
    sections = []
    for node in list(body.children):
        if getattr(node, "name", None) == "h2":
            sections.append({"id": node["id"], "html": ""})
        if sections:
            sections[-1]["html"] += str(node)
    chunks = []
    for section in sections:
        if section["id"] != "s4-formatting":
            chunks.append(section)
            continue
        parts = []
        for node in BeautifulSoup(section["html"], "html.parser").contents:
            if getattr(node, "name", None) == "h3" or not parts:
                parts.append([])
            parts[-1].append(str(node))
        current = ""
        number = 1
        for part in parts:
            text = "".join(part)
            if current and len(current) + len(text) > 10000:
                chunks.append({"id": f"s4-formatting-{number}", "html": current})
                number += 1
                current = ""
            current += text
        if current:
            chunks.append({"id": f"s4-formatting-{number}", "html": current})
    return chunks


def signature(soup: BeautifulSoup) -> list:
    inline = {"a", "strong", "em", "code", "span", "br"}
    blocks = [soup, *[tag for tag in soup.find_all(True) if tag.name not in inline]]
    indices = {id(tag): index for index, tag in enumerate(blocks)}
    result = []
    for block in blocks:
        attrs = sorted((key, tuple(value) if isinstance(value, list) else value)
                       for key, value in block.attrs.items())
        parent = block.parent
        while parent is not None and id(parent) not in indices:
            parent = parent.parent
        markers = []
        for tag in block.find_all(inline):
            owner = tag.parent
            while owner is not None and owner.name in inline:
                owner = owner.parent
            if owner is block:
                markers.append((tag.name, sorted(
                    (key, tuple(value) if isinstance(value, list) else value)
                    for key, value in tag.attrs.items()),
                    tag.get_text() if tag.name == "code" else ""))
        result.append((block.name, attrs, indices.get(id(parent)), sorted(markers)))
    return result


def validate_translation(original: str, translated: str, name: str) -> dict:
    en = BeautifulSoup(original, "html.parser")
    zh = BeautifulSoup(translated, "html.parser")
    if signature(en) != signature(zh):
        raise ValueError(f"{name}: block structure or element attributes differ from upstream")
    for kind in ("pre", "code"):
        en_code = [tag.get_text() for tag in en.find_all(kind)]
        zh_code = [tag.get_text() for tag in zh.find_all(kind)]
        if kind == "code":
            en_code.sort()
            zh_code.sort()
        if en_code != zh_code:
            raise ValueError(f"{name}: {kind} examples differ from upstream")
    # Every prose-bearing block must retain text and include Chinese unless it is
    # composed entirely of protected code, identifiers, or short example words.
    for old, new in zip(en.find_all(["p", "li", "th", "td", "h2", "h3", "h4", "h5"]),
                        zh.find_all(["p", "li", "th", "td", "h2", "h3", "h4", "h5"])):
        old_copy = BeautifulSoup(str(old), "html.parser")
        new_copy = BeautifulSoup(str(new), "html.parser")
        for code in old_copy.find_all(["pre", "code"]):
            code.decompose()
        for code in new_copy.find_all(["pre", "code"]):
            code.decompose()
        old_text = old_copy.get_text(" ", strip=True)
        new_text = new_copy.get_text(" ", strip=True)
        if re.search(r"[A-Za-z]{2,}", old_text) and len(old_text.split()) >= 5:
            if not re.search(r"[\u3400-\u9fff]", new_text):
                raise ValueError(f"{name}: untranslated or missing prose: {old_text[:100]}")
    return {
        "chunk": name,
        "headings": len(en.find_all(re.compile(r"^h[2-5]$"))),
        "code_elements": len(en.find_all("code")),
        "code_blocks": len(en.find_all("pre")),
        "translation_sha256": hashlib.sha256(translated.encode()).hexdigest(),
    }


def main() -> None:
    metadata = json.loads((ROOT / "source.json").read_text())
    source = (ROOT / "upstream/javaguide.html").read_text()
    if hashlib.sha256(source.encode()).hexdigest() != metadata["source_sha256"]:
        raise ValueError("Pinned upstream source checksum does not match source.json")
    chunks = source_chunks(source)
    translated = []
    reports = []
    for chunk in chunks:
        name = chunk["id"]
        translation = (ROOT / "translations" / f"{name}.html").read_text()
        reports.append(validate_translation(chunk["html"], translation, name))
        translated.append(translation)
    content = "\n".join(translated)
    article = BeautifulSoup(content, "html.parser")
    ids = [tag["id"] for tag in article.find_all(id=True)]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate section IDs")
    for link in article.select('a[href^="#"]'):
        if link["href"][1:] not in ids:
            raise ValueError(f"Unresolved section link: {link['href']}")
    template = (ROOT / "template.html").read_text()
    if template.count("__GUIDE_CONTENT__") != 1:
        raise ValueError("Template must contain exactly one guide content placeholder")
    page = (template.replace("__GUIDE_CONTENT__", content)
            .replace("__SOURCE_DATE__", metadata["upstream_updated_at"][:10])
            .replace("__SOURCE_COMMIT__", metadata["upstream_commit"]))
    if re.search(r"__[A-Z_]+__", page):
        raise ValueError("Unresolved template placeholder")
    parsed_page = BeautifulSoup(page, "html.parser")
    all_ids = [tag["id"] for tag in parsed_page.find_all(id=True)]
    if len(all_ids) != len(set(all_ids)):
        raise ValueError("Template and article contain duplicate IDs")
    for link in parsed_page.select('a[href^="#"]'):
        if link["href"][1:] not in all_ids:
            raise ValueError(f"Unresolved page link: {link['href']}")
    (ROOT / "index.html").write_text(page)
    print(f"Built index.html: {len(chunks)} Gemini chunks, "
          f"{sum(r['headings'] for r in reports)} headings, "
          f"{sum(r['code_blocks'] for r in reports)} unchanged code blocks, "
          f"{sum(r['code_elements'] for r in reports)} unchanged code elements, "
          f"{len(ids)} preserved anchors.")


if __name__ == "__main__":
    main()
