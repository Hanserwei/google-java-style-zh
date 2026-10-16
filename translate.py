#!/usr/bin/env python3
"""Translate missing guide chunks with Gemini through an OpenAI-compatible API.

Usage: GEMINI_API_KEY=... python translate.py
Optional: GEMINI_BASE_URL, GEMINI_MODEL, --force, --chunk CHUNK_ID
The build validates every translated chunk before publishing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request

from build import ROOT, source_chunks, validate_translation


def translate(chunk: dict[str, str], api_key: str, base_url: str, model: str) -> dict:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": (ROOT / "translation-prompt.txt").read_text()},
            {"role": "user", "content": chunk["html"]},
        ],
        "max_tokens": 24000,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
        method="POST",
    )
    parts = []
    returned_model = None
    usage = None
    finish_reason = None
    deadline = time.monotonic() + 180
    with urllib.request.urlopen(request, timeout=90) as response:
        if "text/event-stream" not in response.headers.get("Content-Type", ""):
            result = json.load(response)
            parts.append(result["choices"][0]["message"]["content"])
            returned_model = result.get("model")
            usage = result.get("usage")
            finish_reason = result["choices"][0].get("finish_reason")
        else:
            for line in response:
                if time.monotonic() > deadline:
                    raise TimeoutError("Provider exceeded the translation deadline")
                text = line.decode("utf-8").strip()
                if not text.startswith("data:"):
                    continue
                text = text[5:].strip()
                if text == "[DONE]":
                    break
                result = json.loads(text)
                if "error" in result:
                    raise RuntimeError("Provider returned an error in the stream")
                returned_model = result.get("model", returned_model)
                usage = result.get("usage") or usage
                for choice in result.get("choices", []):
                    delta = choice.get("delta", {}).get("content")
                    if delta:
                        parts.append(delta)
                    finish_reason = choice.get("finish_reason") or finish_reason
    if finish_reason != "stop":
        raise RuntimeError(f"Incomplete response: finish_reason={finish_reason!r}")
    content = "".join(parts).strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:html)?\s*|\s*```$", "", content)
    report = validate_translation(chunk["html"], content, chunk["id"])
    destination = ROOT / "translations" / f"{chunk['id']}.html"
    destination.write_text(content)
    return {**report, "requested_model": model, "returned_model": returned_model, "usage": usage}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Regenerate existing translations")
    parser.add_argument("--chunk", help="Translate only the specified chunk")
    args = parser.parse_args()
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        parser.error("Set GEMINI_API_KEY in the environment")
    base_url = os.environ.get("GEMINI_BASE_URL", "https://api.shuaiapi.com/v1")
    model = os.environ.get("GEMINI_MODEL", "gemini-4-argon")
    chunks = source_chunks((ROOT / "upstream/javaguide.html").read_text())
    if args.chunk and args.chunk not in {chunk["id"] for chunk in chunks}:
        parser.error("Unknown chunk ID")
    for chunk in chunks:
        if args.chunk and chunk["id"] != args.chunk:
            continue
        destination = ROOT / "translations" / f"{chunk['id']}.html"
        if destination.exists() and not args.force:
            validate_translation(chunk["html"], destination.read_text(), chunk["id"])
            print(f"Validated existing {chunk['id']}")
            continue
        for attempt in range(3):
            try:
                report = translate(chunk, api_key, base_url, model)
                print(json.dumps(report, ensure_ascii=False))
                break
            except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as error:
                # Do not print request objects, headers, credentials, or provider error bodies.
                print(f"{chunk['id']}: attempt {attempt + 1} failed ({type(error).__name__})")
                if attempt == 2:
                    raise SystemExit("Translation stopped; existing chunks are preserved") from None
                time.sleep(2 ** attempt)


if __name__ == "__main__":
    main()
