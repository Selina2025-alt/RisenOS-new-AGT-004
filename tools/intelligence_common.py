from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
INTELLIGENCE = ROOT / "intelligence"
CONFIG = INTELLIGENCE / "config"
AUDIT = ROOT / "audit"

# Do not depend on zoneinfo data being installed on the deployment host.
CHINA_TZ = timezone(offset=timedelta(hours=8), name="Asia/Shanghai")

SECRET_PATTERNS = [
    re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/-]{12,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}"),
]

SECRET_KEY_PARTS = {
    "apikey",
    "api_key",
    "secret",
    "password",
    "cookie",
    "authorization",
    "access_token",
    "refresh_token",
    "resend_api_key",
}

TRACKING_PARAMETERS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "ref",
    "source",
}


class IntelligenceError(ValueError):
    """A validation or safety error that must fail closed."""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_config(name: str) -> dict[str, Any]:
    path = CONFIG / name
    if not path.exists():
        raise IntelligenceError(f"Missing intelligence config: {path}")
    value = load_json(path)
    if not isinstance(value, dict):
        raise IntelligenceError(f"Config must be a JSON object: {path}")
    return value


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def china_now() -> datetime:
    return utc_now().astimezone(CHINA_TZ)


def isoformat(value: datetime | None = None) -> str:
    target = value or utc_now()
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    return target.isoformat(timespec="seconds")


def parse_datetime(value: Any) -> datetime | None:
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        try:
            return datetime.fromtimestamp(timestamp, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=CHINA_TZ)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass
    try:
        parsed = parsedate_to_datetime(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_value(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest().upper()


def short_hash(value: Any, length: int = 10) -> str:
    return sha256_value(value)[:length]


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def append_audit(event_type: str, payload: dict[str, Any]) -> None:
    AUDIT.mkdir(parents=True, exist_ok=True)
    event = {
        "schemaVersion": "1.0",
        "eventType": event_type,
        "occurredAt": isoformat(),
        **payload,
    }
    path = AUDIT / "intelligence-events.jsonl"
    line = stable_json(event) + "\n"
    # Only the radar/approval process appends here. Feed jobs never share this file.
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())


def redact_sensitive_text(value: Any) -> str:
    text = "" if value is None else str(value)
    # Replace isolated UTF-16 surrogate code points produced by some Windows pipes.
    text = text.encode("utf-8", errors="replace").decode("utf-8")
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[REDACTED_SECRET]", text)
    return text


def contains_secret_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9_]", "", str(key).lower())
            if any(part in normalized for part in SECRET_KEY_PARTS) and child not in (None, "", [], {}):
                return True
            if contains_secret_key(child):
                return True
    elif isinstance(value, list):
        return any(contains_secret_key(item) for item in value)
    return False


def safe_slug(value: str, fallback: str = "item", maximum: int = 80) -> str:
    text = value.strip()
    text = re.sub(r"[<>:\"/\\|?*\x00-\x1F]", "-", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip(".- ")
    if not text or text in {".", ".."}:
        text = fallback
    return text[:maximum]


def _is_private_host(hostname: str) -> bool:
    host = hostname.strip("[]").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def canonicalize_url(raw_url: Any) -> tuple[str, str]:
    text = redact_sensitive_text(raw_url).strip()
    if not text:
        return "", "unverified"
    if len(text) > 2048:
        return "", "rejected"
    try:
        parsed = urlsplit(text)
    except ValueError:
        return "", "rejected"
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname or _is_private_host(parsed.hostname):
        return "", "rejected"
    hostname = parsed.hostname.lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError:
        return "", "rejected"
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    query_pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMETERS
    ]
    query = urlencode(sorted(query_pairs), doseq=True)
    canonical = urlunsplit((scheme, netloc, path, query, ""))
    return canonical, "traceable"


def first_present(mapping: dict[str, Any], keys: Iterable[str], default: Any = None) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return default


def detect_language(text: str) -> str:
    if re.search(r"[\u4e00-\u9fff]", text):
        return "zh"
    if re.search(r"[A-Za-z]", text):
        return "en"
    return "und"


def flatten_candidate_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    # follow-builders has three distinct collections and nests tweets under people.
    if any(key in payload for key in ("podcasts", "x", "blogs")):
        combined: list[dict[str, Any]] = []
        for episode in payload.get("podcasts", []):
            if not isinstance(episode, dict):
                continue
            transcript = str(episode.get("transcript", ""))
            combined.append(
                {
                    **{key: value for key, value in episode.items() if key != "transcript"},
                    "summary": transcript[:1200],
                    "sourceType": "podcast",
                }
            )
        for builder in payload.get("x", []):
            if not isinstance(builder, dict):
                continue
            for tweet in builder.get("tweets", []):
                if not isinstance(tweet, dict):
                    continue
                tweet_text = str(tweet.get("text", "")).strip()
                first_sentence = re.split(r"[\r\n.!?。！？]", tweet_text, maxsplit=1)[0].strip()
                short_title = first_sentence or tweet_text
                if len(short_title) > 120:
                    short_title = short_title[:117].rstrip() + "…"
                combined.append(
                    {
                        **tweet,
                        "title": f"{builder.get('name', 'AI Builder')}：{short_title}",
                        "summary": tweet_text,
                        "author": builder.get("name"),
                        "sourceName": builder.get("name"),
                        "sourceType": "x",
                        "publishedAt": tweet.get("createdAt"),
                    }
                )
        for post in payload.get("blogs", []):
            if not isinstance(post, dict):
                continue
            combined.append(
                {
                    **{key: value for key, value in post.items() if key != "content"},
                    "summary": post.get("description") or str(post.get("content", ""))[:1200],
                    "sourceType": "official_blog",
                }
            )
        return combined
    for key in ("items", "results", "articles", "entries", "tweets", "content"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    for key in ("data", "digest", "payload"):
        nested = payload.get(key)
        result = flatten_candidate_items(nested)
        if result:
            return result
    return []


def normalize_signal_item(raw: dict[str, Any], feed_id: str, discovered_at: str) -> dict[str, Any] | None:
    title = redact_sensitive_text(
        first_present(raw, ("title", "title_en", "headline", "name", "text"), "")
    ).strip()
    if not title:
        return None
    raw_url = first_present(
        raw,
        ("url", "permalink", "link", "sourceUrl", "articleUrl", "shortLink"),
        "",
    )
    canonical_url, verification = canonicalize_url(raw_url)
    source_name = redact_sensitive_text(
        first_present(raw, ("sourceName", "source", "publisher", "platform", "channel"), feed_id)
    ).strip()
    source_type = redact_sensitive_text(
        first_present(raw, ("sourceType", "type", "platformId"), feed_id)
    ).strip()
    summary = redact_sensitive_text(
        first_present(raw, ("summary", "description", "snippet", "aiSummary", "content"), "")
    ).strip()
    if len(summary) > 1200:
        summary = summary[:1200].rstrip() + "…"
    published = parse_datetime(
        first_present(
            raw,
            ("publishedAt", "published_at", "publishTime", "publishTimestamp", "date", "created_at"),
        )
    )
    raw_heat: dict[str, Any] = {}
    for key in (
        "score",
        "heatScore",
        "likes",
        "comments",
        "saves",
        "views",
        "viewCount",
        "readCount",
        "retweets",
    ):
        value = raw.get(key)
        if isinstance(value, (int, float)):
            raw_heat[key] = value
    metrics = raw.get("metrics")
    if isinstance(metrics, dict):
        for key, value in metrics.items():
            if isinstance(value, (int, float)):
                raw_heat[str(key)] = value
    category = redact_sensitive_text(
        first_present(raw, ("category", "content_type", "topic", "section"), "uncategorized")
    ).strip()
    author = first_present(raw, ("author", "authorName", "creator", "channelTitle"))
    author_text = redact_sensitive_text(author).strip() if author not in (None, "") else None
    signal_seed = canonical_url or f"{feed_id}|{title.lower()}|{source_name.lower()}"
    source_id = f"SIG-{feed_id.upper().replace('-', '')}-{short_hash(signal_seed, 12)}"
    return {
        "signalId": source_id,
        "title": title[:500],
        "url": canonical_url,
        "canonicalUrl": canonical_url,
        "sourceName": source_name[:200],
        "sourceType": source_type[:100],
        "author": author_text[:200] if author_text else None,
        "publishedAt": isoformat(published) if published else None,
        "discoveredAt": discovered_at,
        "summary": summary,
        "category": category[:100],
        "language": detect_language(f"{title} {summary}"),
        "rawHeatSignals": raw_heat,
        "sourceFeed": feed_id,
        "provenance": [
            {
                "feedId": feed_id,
                "sourceItemId": redact_sensitive_text(first_present(raw, ("id", "contentId"), "")),
            }
        ],
        "verificationStatus": verification if canonical_url else "unverified",
    }


def validate_signal_item(item: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = (
        "signalId",
        "title",
        "url",
        "canonicalUrl",
        "sourceName",
        "sourceType",
        "publishedAt",
        "discoveredAt",
        "summary",
        "category",
        "language",
        "rawHeatSignals",
        "sourceFeed",
        "provenance",
        "verificationStatus",
    )
    for key in required:
        if key not in item:
            errors.append(f"SignalItem missing {key}")
    if not str(item.get("title", "")).strip():
        errors.append("SignalItem title is empty")
    if item.get("verificationStatus") not in {"traceable", "metadata_only", "unverified", "rejected"}:
        errors.append("SignalItem verificationStatus is invalid")
    if item.get("canonicalUrl"):
        canonical, status = canonicalize_url(item["canonicalUrl"])
        if status == "rejected" or canonical != item["canonicalUrl"]:
            errors.append("SignalItem canonicalUrl is unsafe or not canonical")
    return errors


def validate_feed_run(run: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = (
        "schemaVersion",
        "feedId",
        "runId",
        "windowStart",
        "windowEnd",
        "collectedAt",
        "status",
        "errors",
        "items",
        "inputHash",
    )
    for key in required:
        if key not in run:
            errors.append(f"FeedRun missing {key}")
    if run.get("schemaVersion") != "1.0":
        errors.append("FeedRun schemaVersion must be 1.0")
    if run.get("feedId") not in {"aihot", "agentreach", "follow-builders"}:
        errors.append("FeedRun feedId is invalid")
    if run.get("status") not in {"SUCCESS", "DEGRADED", "EMPTY", "FAILED"}:
        errors.append("FeedRun status is invalid")
    for key in ("windowStart", "windowEnd", "collectedAt"):
        if parse_datetime(run.get(key)) is None:
            errors.append(f"FeedRun {key} is not a valid date-time")
    if not isinstance(run.get("items"), list):
        errors.append("FeedRun items must be an array")
    else:
        for index, item in enumerate(run["items"]):
            if not isinstance(item, dict):
                errors.append(f"FeedRun item {index} is not an object")
            else:
                errors.extend(f"item[{index}]: {error}" for error in validate_signal_item(item))
    input_hash = str(run.get("inputHash", ""))
    if not re.fullmatch(r"[A-F0-9]{64}", input_hash):
        errors.append("FeedRun inputHash must be uppercase SHA-256")
    return errors


def guard_public_query(query: str) -> tuple[bool, list[str]]:
    policy = load_config("public-query-policy.json")
    text = query.strip()
    reasons: list[str] = []
    if not text:
        reasons.append("query is empty")
    if len(text) > int(policy.get("maximumQueryLength", 180)):
        reasons.append("query is too long")
    if "\n" in text or "\r" in text:
        reasons.append("query contains line breaks")
    lowered = text.lower()
    for marker in policy.get("blockedMarkers", []):
        if str(marker).lower() in lowered:
            reasons.append(f"query contains blocked marker: {marker}")
    for pattern_text in policy.get("secretPatterns", []):
        if re.search(pattern_text, text):
            reasons.append("query contains a credential-like value")
            break
    if re.search(r"[A-Za-z]:\\|/(?:home|users|etc|var)/", text):
        reasons.append("query contains a local filesystem path")
    return not reasons, reasons
