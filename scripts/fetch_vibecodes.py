#!/usr/bin/env python3
"""Refresh the AIWeb catalog from GitHub Search in small, paced batches."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "projects.json"
STATE_PATH = ROOT / "data" / "fetch-state.json"
API_URL = "https://api.github.com/search/repositories"
USER_AGENT = "AIWeb-vibe-radar/1.0"
REQUEST_GAP_SECONDS = 1.75
MAX_SEARCH_RESULTS_PER_QUERY = 24
MAX_NEW_PROJECTS_PER_RUN = 12
MAX_LIBRARY_SIZE = 72

SEARCHES = [
    ("vibecoding", "topic:vibecoding"),
    ("vibe-coding", "topic:vibe-coding"),
    ("vibe-phrase", '"vibe coding" in:name,description,readme'),
    ("generative-ui", "topic:generative-ui"),
]
ALLOWED_SOURCE_QUERIES = {name for name, _ in SEARCHES}

AI_TERMS = {
    "ai": 2,
    "llm": 3,
    "gpt": 3,
    "claude": 3,
    "gemini": 3,
    "codex": 3,
    "copilot": 2,
    "agent": 3,
    "mcp": 2,
    "generative": 2,
    "deepseek": 2,
    "anthropic": 2,
    "openai": 2,
    "vibe coding": 3,
    "vibecoding": 3,
}
VIBE_TERMS = {"vibe", "vibecoding", "vibe coding", "ai-first", "prompt", "agentic", "coding agent", "ai-native"}
PRODUCT_TERMS = {"app", "tool", "plugin", "skill", "editor", "extension", "cli", "dashboard", "generator", "assistant", "studio", "canvas", "workflow", "bot", "web", "ui", "automation", "utility"}
SMALL_TERMS = {"skill", "plugin", "extension", "utility", "generator", "editor", "canvas", "diagram", "slides", "prompt", "mcp", "cli", "checker", "converter", "viewer", "summarizer", "extractor", "search", "graph", "memory", "tool", "terminal", "pwa", "widget", "template", "component", "skill"}
EXCLUDE_TERMS = {"awesome list", "awesome-list", "course", "tutorial", "roadmap", "guide", "book", "collection", "resources"}

_last_request_at = 0.0


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request_json(params: dict) -> dict | None:
    global _last_request_at
    elapsed = time.monotonic() - _last_request_at
    if elapsed < REQUEST_GAP_SECONDS:
        time.sleep(REQUEST_GAP_SECONDS - elapsed)

    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    token = os.getenv("GITHUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    _last_request_at = time.monotonic()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            retry_after = error.headers.get("Retry-After")
            should_retry = error.code in {403, 429, 500, 502, 503, 504}
            if not should_retry or attempt == 3:
                print(f"GitHub Search skipped ({error.code}) for {params.get('q')}")
                return None
            wait_seconds = int(retry_after) if retry_after and retry_after.isdigit() else min(30, 2 ** (attempt + 1))
            print(f"GitHub Search rate limited; waiting {wait_seconds}s")
            time.sleep(wait_seconds)
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                print(f"GitHub Search network error: {error}")
                return None
            time.sleep(min(30, 2 ** (attempt + 1)))
    return None


def token_hits(text: str, terms: set[str]) -> list[str]:
    lowered = text.lower()
    hits = []
    for term in terms:
        pattern = r"(?<![a-z0-9])" + re.escape(term.lower()).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
        if re.search(pattern, lowered):
            hits.append(term)
    return hits


def clean_text(value: str | None, limit: int = 190) -> str:
    text = re.sub(r"\s+", " ", (value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def parse_date(value: str | None) -> datetime:
    if not value:
        return now_utc() - timedelta(days=365)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return now_utc() - timedelta(days=365)


def classify(text: str, topics: list[str]) -> str:
    searchable = f"{text} {' '.join(topics)}"
    if token_hits(searchable, {"design", "ui", "frontend", "canvas", "slide", "pencil", "figma"}):
        return "UI / Design"
    if token_hits(searchable, {"agent", "claude", "codex", "mcp", "skill", "copilot", "workflow"}):
        return "Agent"
    if token_hits(searchable, {"app", "tool", "plugin", "editor", "extension", "cli", "utility", "assistant", "generator"}):
        return "AI Tool"
    return "Vibe Coding"


def stable_cover_color(repo: str) -> str:
    colors = ["#214b4c", "#3f345f", "#624237", "#244867", "#5b3d5c", "#345449"]
    digest = hashlib.sha1(repo.encode("utf-8")).hexdigest()
    return colors[int(digest[:2], 16) % len(colors)]


def passes_quality_gate(name: str, repo: str, description: str, topics: list[str]) -> bool:
    searchable = " ".join([name, description, repo, " ".join(topics)])
    ai_hits = token_hits(searchable, set(AI_TERMS))
    vibe_hits = token_hits(searchable, VIBE_TERMS)
    product_hits = token_hits(searchable, PRODUCT_TERMS)
    small_hits = token_hits(searchable, SMALL_TERMS)
    exclude_hits = token_hits(searchable, EXCLUDE_TERMS)
    if not ai_hits or not (vibe_hits or product_hits):
        return False
    if not small_hits or exclude_hits:
        return False
    return True


def candidate_from_item(item: dict, query_name: str) -> dict | None:
    name = str(item.get("name") or "").strip()
    repo = str(item.get("full_name") or "").strip()
    description = clean_text(item.get("description"))
    topics = [str(topic).replace("_", "-") for topic in item.get("topics") or []]
    searchable = " ".join([name, description, repo, " ".join(topics)])
    ai_hits = token_hits(searchable, set(AI_TERMS))
    vibe_hits = token_hits(searchable, VIBE_TERMS)
    product_hits = token_hits(searchable, PRODUCT_TERMS)
    exclude_hits = token_hits(searchable, EXCLUDE_TERMS)

    # Require an explicit AI signal plus either a Vibe signal or a concrete product signal.
    if not passes_quality_gate(name, repo, description, topics):
        return None

    stars = int(item.get("stargazers_count") or 0)
    forks = int(item.get("forks_count") or 0)
    pushed_at = item.get("pushed_at") or item.get("updated_at")
    created_at = item.get("created_at")
    age_days = max(0.0, (now_utc() - parse_date(pushed_at)).total_seconds() / 86400)
    freshness = max(0.0, 1.0 - min(age_days, 365.0) / 365.0)
    popularity = math.log10(stars + 1) * 17
    signals = min(30, len(ai_hits) * 4 + len(vibe_hits) * 2 + len(product_hits) * 2)
    score = round(popularity + freshness * 28 + signals, 1)
    category = classify(searchable, topics)
    tags = []
    for tag in [category, *topics, *ai_hits]:
        display = tag.strip().replace("-", " ")
        if not display or display.lower() in {item.lower() for item in tags}:
            continue
        tags.append(display if display.lower() != "ai" else "AI")
        if len(tags) == 4:
            break

    return {
        "id": repo.lower().replace("/", "__"),
        "repo": repo,
        "name": name,
        "description": description or "这个项目还没有提供简介。",
        "url": item.get("html_url") or f"https://github.com/{repo}",
        "stars": stars,
        "forks": forks,
        "language": item.get("language") or "多语言",
        "topics": topics[:8],
        "category": category,
        "tags": tags[:4],
        "thumbnail": f"https://opengraph.githubassets.com/1/{repo}",
        "coverHeight": 165 + (int(hashlib.sha1(repo.encode()).hexdigest()[:2], 16) % 105),
        "coverColor": stable_cover_color(repo),
        "score": score,
        "aiSignals": sorted(set(ai_hits + vibe_hits))[:8],
        "sourceQuery": query_name,
        "createdAt": created_at,
        "pushedAt": pushed_at,
        "likes": 0,
    }


def main() -> None:
    payload = load_json(DATA_PATH, {"generatedAt": None, "items": []})
    state = load_json(STATE_PATH, {"nextSearch": 0, "runs": 0})
    existing = payload.get("items") if isinstance(payload, dict) else []
    existing = existing if isinstance(existing, list) else []
    existing = [
        item for item in existing
        if item.get("sourceQuery") in ALLOWED_SOURCE_QUERIES
    ]
    existing = [
        item for item in existing
        if passes_quality_gate(
            str(item.get("name") or ""),
            str(item.get("repo") or ""),
            str(item.get("description") or ""),
            [str(topic) for topic in item.get("topics") or []],
        )
    ]

    next_search = int(state.get("nextSearch", 0)) % len(SEARCHES)
    selected_searches = [SEARCHES[next_search], SEARCHES[(next_search + 1) % len(SEARCHES)]]
    since = (now_utc() - timedelta(days=180)).date().isoformat()
    candidates: list[dict] = []
    seen: set[str] = set()

    for query_name, base_query in selected_searches:
        result = request_json({
            "q": f"{base_query} pushed:>={since} stars:>=8",
            "sort": "stars",
            "order": "desc",
            "per_page": MAX_SEARCH_RESULTS_PER_QUERY,
            "page": 1,
        })
        if not result:
            continue
        for item in result.get("items") or []:
            repo = str(item.get("full_name") or "").lower()
            if not repo or repo in seen:
                continue
            seen.add(repo)
            candidate = candidate_from_item(item, query_name)
            if candidate:
                candidates.append(candidate)

    candidates.sort(key=lambda item: (float(item.get("score", 0)), int(item.get("stars", 0))), reverse=True)
    candidates = candidates[:MAX_NEW_PROJECTS_PER_RUN]

    by_repo = {str(item.get("repo", "")).lower(): item for item in existing if item.get("repo")}
    for candidate in candidates:
        old = by_repo.get(candidate["repo"].lower(), {})
        if old:
            candidate["likes"] = int(old.get("likes") or 0)
        by_repo[candidate["repo"].lower()] = {**old, **candidate}

    items = list(by_repo.values())
    items.sort(key=lambda item: (float(item.get("score", 0)), int(item.get("stars", 0))), reverse=True)
    items = items[:MAX_LIBRARY_SIZE]
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank

    generated_at = now_utc().isoformat().replace("+00:00", "Z")
    output = {
        "generatedAt": generated_at,
        "batch": {
            "size": len(candidates),
            "queries": [name for name, _ in selected_searches],
            "window": f"pushed since {since}",
        },
        "items": items,
    }
    next_state = {
        "nextSearch": (next_search + 2) % len(SEARCHES),
        "runs": int(state.get("runs", 0)) + 1,
        "lastRun": generated_at,
    }
    save_json(DATA_PATH, output)
    save_json(STATE_PATH, next_state)
    print(f"AIWeb catalog refreshed: +{len(candidates)} projects, {len(items)} total, queries={output['batch']['queries']}")


if __name__ == "__main__":
    main()
