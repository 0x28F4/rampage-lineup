from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = ROOT / "public"
ARTISTS_FILE = SITE_ROOT / "artists.json"
CATALOG_FILE = SITE_ROOT / "media_catalog.json"
PROVIDER = "youtube"

BAD_TITLE_MARKERS = (
    "live",
    "live stream",
    "livestream",
    "full set",
    "extended set",
    "mix",
    "festival",
    "b2b",
    "interview",
    "reaction",
    "teaser",
    "trailer",
    "shorts",
    "hour",
    "album",
    "compilation",
)
GOOD_TITLE_MARKERS = (
    "official",
    "audio",
    "video",
    "visualizer",
    "music video",
    "topic",
)
GENERIC_CHANNEL_MARKERS = (
    "theatres",
    "news",
    "trailers",
    "movies",
    "music south",
    "records",
    "tv",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a generic media catalog from YouTube search results.")
    parser.add_argument("--limit", type=int, default=0, help="Resolve at most N unresolved artists in this run.")
    parser.add_argument("--delay", type=float, default=0.2, help="Seconds to wait between artist searches.")
    parser.add_argument("--results", type=int, default=8, help="YouTube search results to inspect per artist.")
    parser.add_argument("--force", action="store_true", help="Rebuild entries that already exist.")
    args = parser.parse_args()

    artists = read_artists()
    catalog = read_catalog()
    resolved_this_run = 0

    for artist_name in artists:
        if args.limit and resolved_this_run >= args.limit:
            break
        if not args.force and artist_name in catalog["artists"]:
            continue

        print(f"Resolving {artist_name}...")
        catalog["artists"][artist_name] = resolve_artist(artist_name, args.results)
        write_catalog(catalog)
        resolved_this_run += 1
        time.sleep(args.delay)

    resolved = sum(1 for entry in catalog["artists"].values() if entry.get("resolved"))
    supported = sum(1 for entry in catalog["artists"].values() if entry.get("supported"))
    print(f"Catalog entries: {len(catalog['artists'])} / {len(artists)}")
    print(f"Resolved artists: {resolved}")
    print(f"Supported artists: {supported}")


def resolve_artist(artist_name: str, results: int) -> dict[str, Any]:
    entries = youtube_search(artist_name, results)
    best = best_reference(artist_name, entries)
    if not best:
        return {
            "supported": False,
            "resolved": False,
            "artist_name": artist_name,
            "reference": None,
            "reason": "No credible YouTube song candidate found",
        }

    return {
        "supported": True,
        "resolved": True,
        "artist_name": artist_name,
        "reference": best,
        "reason": best["reason"],
    }


def read_artists() -> list[str]:
    data = json.loads(ARTISTS_FILE.read_text())
    return [artist if isinstance(artist, str) else artist["name"] for artist in data]


def youtube_search(artist_name: str, limit: int) -> list[dict[str, Any]]:
    query = f"ytsearch{limit}:{artist_name} official audio"
    command = [
        "yt-dlp",
        "--dump-single-json",
        "--no-warnings",
        "--flat-playlist",
        query,
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    return data.get("entries", [])


def best_reference(artist_name: str, entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = []
    for entry in entries:
        scored = score_entry(artist_name, entry)
        if scored:
            candidates.append(scored)
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item["score"], item["rank"]))
    best = candidates[0]
    return {
        "provider": PROVIDER,
        "item_id": best["item_id"],
        "url": best["url"],
        "title": best["title"],
        "artist_name": artist_name,
        "channel": best["channel"],
        "duration_seconds": best["duration_seconds"],
        "view_count": best["view_count"],
        "confidence": best["confidence"],
        "reason": best["reason"],
    }


def score_entry(artist_name: str, entry: dict[str, Any]) -> dict[str, Any] | None:
    title = entry.get("title", "")
    channel = entry.get("channel") or entry.get("uploader") or ""
    item_id = entry.get("id")
    if not title or not item_id:
        return None

    normalized_artist = normalize(artist_name)
    normalized_title = normalize(title)
    normalized_channel = normalize(channel)
    if normalized_artist and normalized_artist not in normalized_title and normalized_artist not in normalized_channel:
        return None

    title_has_artist = contains_artist_phrase(artist_name, title)
    channel_has_artist = contains_artist_phrase(artist_name, channel)
    title_leads_with_artist = leads_with_artist(artist_name, title)
    title_credits_artist = title_credits_artist_name(artist_name, title)
    channel_exact_artist = channel_exact_match(artist_name, channel)
    artist_is_single_token = len(tokenize(artist_name)) == 1

    lower_title = title.lower()
    lower_channel = channel.lower()
    duration_seconds = int(entry.get("duration") or 0)
    view_count = int(entry.get("view_count") or 0)

    if duration_seconds and duration_seconds > 600:
        return None

    score = 0
    reasons = []

    if title_has_artist:
        score += 40
        reasons.append("artist name in title")
    if channel_has_artist:
        score += 18
        reasons.append("artist name in channel")
    if title_leads_with_artist:
        score += 20
        reasons.append("title leads with artist")
    if title_credits_artist:
        score += 24
        reasons.append("title credits artist")
    if channel_exact_artist:
        score += 28
        reasons.append("channel closely matches artist")
    if any(marker in lower_title for marker in GOOD_TITLE_MARKERS):
        score += 12
        reasons.append("official/audio marker in title")
    if "topic" in lower_channel:
        score += 10
        reasons.append("topic channel")
    if 90 <= duration_seconds <= 420:
        score += 8
        reasons.append("song-length duration")
    if any(marker in lower_title for marker in BAD_TITLE_MARKERS):
        score -= 22
        reasons.append("live/mix/non-song penalty")
    if any(marker in lower_channel for marker in GENERIC_CHANNEL_MARKERS):
        score -= 25
        reasons.append("generic channel penalty")

    score += min(view_count / 1_000_000, 25)
    confidence = max(0.0, min(0.99, score / 100))

    if artist_is_single_token and not (title_credits_artist or channel_exact_artist):
        return None
    if score < 30:
        return None

    return {
        "item_id": item_id,
        "url": f"https://www.youtube.com/watch?v={item_id}",
        "title": title,
        "channel": channel,
        "duration_seconds": duration_seconds,
        "view_count": view_count,
        "confidence": round(confidence, 2),
        "reason": "; ".join(reasons) if reasons else "best YouTube match",
        "score": score,
        "rank": len(reasons),
    }


def read_catalog() -> dict[str, Any]:
    if not CATALOG_FILE.exists():
        return {"version": 1, "provider": PROVIDER, "artists": {}}
    data = json.loads(CATALOG_FILE.read_text())
    data.setdefault("version", 1)
    data.setdefault("provider", PROVIDER)
    data.setdefault("artists", {})
    for artist_name, entry in data["artists"].items():
        entry.setdefault("artist_name", artist_name)
        entry.setdefault("supported", bool(entry.get("resolved") and entry.get("reference")))
    return data


def write_catalog(catalog: dict[str, Any]) -> None:
    CATALOG_FILE.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n")


def normalize(value: str) -> str:
    value = value.lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", value)


def tokenize(value: str) -> list[str]:
    return [part for part in re.split(r"[^a-z0-9]+", value.lower().replace("&", "and")) if part]


def contains_artist_phrase(artist_name: str, value: str) -> bool:
    artist_tokens = tokenize(artist_name)
    value_tokens = tokenize(value)
    if not artist_tokens or len(artist_tokens) > len(value_tokens):
        return False
    for start in range(len(value_tokens) - len(artist_tokens) + 1):
        if value_tokens[start : start + len(artist_tokens)] == artist_tokens:
            return True
    return False


def leads_with_artist(artist_name: str, value: str) -> bool:
    artist_tokens = tokenize(artist_name)
    value_tokens = tokenize(value)
    if not artist_tokens or len(artist_tokens) > len(value_tokens):
        return False
    return value_tokens[: len(artist_tokens)] == artist_tokens


def channel_exact_match(artist_name: str, channel: str) -> bool:
    normalized_artist = normalize(artist_name)
    normalized_channel = normalize(channel.removesuffix(" - topic"))
    return normalized_channel == normalized_artist


def title_credits_artist_name(artist_name: str, title: str) -> bool:
    artist_tokens = tokenize(artist_name)
    title_tokens = tokenize(title)
    if not artist_tokens or len(artist_tokens) > len(title_tokens):
        return False
    if title_tokens[: len(artist_tokens)] != artist_tokens:
        return False

    remainder = title[len(title.lstrip()):]
    pattern = re.compile(rf"^\s*{re.escape(artist_name)}\s*(?:[-,:|/&]|\b(?:x|ft|feat|featuring|with)\b)", re.IGNORECASE)
    return bool(pattern.search(remainder))


if __name__ == "__main__":
    main()
