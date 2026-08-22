from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from intelligence_common import (
    CHINA_TZ,
    INTELLIGENCE,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    atomic_write_text,
    canonicalize_url,
    china_now,
    isoformat,
    load_config,
    load_json,
    parse_datetime,
    sha256_value,
    short_hash,
)


FEEDS = ("aihot", "agentreach", "follow-builders")
SCORING_ENGINE_VERSION = "track-v3.4"
STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "about",
    "using",
    "发布",
    "推出",
    "最新",
    "今日",
    "一个",
    "一种",
    "人工智能",
}


def _hostname(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def _domain_matches(host: str, domain: str) -> bool:
    normalized = domain.lower().lstrip(".")
    return host == normalized or host.endswith(f".{normalized}")


def _source_profile(signal: dict[str, Any], source_policy: dict[str, Any]) -> dict[str, str]:
    host = _hostname(signal.get("canonicalUrl", ""))
    source_name = str(signal.get("sourceName", "")).lower()
    for publisher in source_policy.get("officialPublishers", []):
        name = str(publisher.get("name", ""))
        domains = [str(domain) for domain in publisher.get("domains", [])]
        domain_match = any(_domain_matches(host, domain) for domain in domains)
        identity_match = bool(name) and (
            name.lower() in source_name
            or any(_domain_matches(host, domain) and host.split(".")[0] in source_name for domain in domains)
        )
        if domain_match and (identity_match or name in {"arXiv", "中国政府网"}):
            return {
                "sourceRole": "primary",
                "authorityTier": "S",
                "verificationStatus": "metadata_only",
                "publisher": name,
            }
    if str(signal.get("sourceType", "")).lower() in {"x", "twitter", "podcast"}:
        return {
            "sourceRole": "opinion",
            "authorityTier": "B",
            "verificationStatus": "metadata_only",
            "publisher": signal.get("sourceName") or host,
        }
    if signal.get("verificationStatus") == "traceable":
        return {
            "sourceRole": "secondary",
            "authorityTier": "B",
            "verificationStatus": "metadata_only",
            "publisher": signal.get("sourceName") or host,
        }
    return {
        "sourceRole": "lead_only",
        "authorityTier": "C",
        "verificationStatus": "unverified",
        "publisher": signal.get("sourceName") or host,
    }


def _title_features(text: str) -> set[str]:
    lowered = text.lower()
    english = {
        token
        for token in re.findall(r"[a-z0-9][a-z0-9.+-]{1,}", lowered)
        if token not in STOPWORDS
    }
    chinese_runs = re.findall(r"[\u4e00-\u9fff]{2,}", lowered)
    chinese: set[str] = set()
    for run in chinese_runs:
        if run in STOPWORDS:
            continue
        if len(run) <= 4:
            chinese.add(run)
        for size in (2, 3):
            chinese.update(run[index : index + size] for index in range(max(0, len(run) - size + 1)))
    return english | chinese


def _similarity(left: str, right: str) -> float:
    left_clean = re.sub(r"\W+", "", left.lower())
    right_clean = re.sub(r"\W+", "", right.lower())
    if left_clean and right_clean and (left_clean in right_clean or right_clean in left_clean):
        shorter = min(len(left_clean), len(right_clean))
        longer = max(len(left_clean), len(right_clean))
        if shorter >= 10:
            return shorter / max(longer, 1)
    left_set = _title_features(left)
    right_set = _title_features(right)
    if not left_set or not right_set:
        return 0
    intersection = len(left_set & right_set)
    union = len(left_set | right_set)
    jaccard = intersection / max(union, 1)
    important = {
        "openai",
        "anthropic",
        "google",
        "microsoft",
        "meta",
        "claude",
        "chatgpt",
        "codex",
        "sandbox",
        "security",
        "安全",
    }
    shared_important = (left_set & right_set) & important
    # Shared company/model names are not enough to declare the same event.
    # Requiring a minimum lexical overlap avoids merging separate security
    # incidents merely because both mention e.g. Anthropic and Claude.
    if intersection >= 3 and shared_important and jaccard >= 0.25:
        return max(jaccard, 0.40)
    if len(shared_important) >= 2 and jaccard >= 0.22:
        return max(jaccard, 0.39)
    return jaccard


def _merge_duplicates(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for signal in signals:
        canonical, status = canonicalize_url(signal.get("canonicalUrl") or signal.get("url"))
        if status == "rejected":
            canonical = ""
        signal = {**signal, "url": canonical, "canonicalUrl": canonical}
        key = canonical or re.sub(r"\W+", "", signal.get("title", "").lower())
        if not key:
            continue
        existing = by_key.get(key)
        if not existing:
            by_key[key] = signal
            continue
        if len(signal.get("summary", "")) > len(existing.get("summary", "")):
            existing["summary"] = signal["summary"]
        existing_provenance = existing.setdefault("provenance", [])
        for provenance in signal.get("provenance", []):
            if provenance not in existing_provenance:
                existing_provenance.append(provenance)
        existing_feeds = set(existing.get("sourceFeeds", [existing.get("sourceFeed")]))
        existing_feeds.add(signal.get("sourceFeed"))
        existing["sourceFeeds"] = sorted(feed for feed in existing_feeds if feed)
        for key_name, value in signal.get("rawHeatSignals", {}).items():
            current = existing.setdefault("rawHeatSignals", {}).get(key_name)
            if not isinstance(current, (int, float)) or (
                isinstance(value, (int, float)) and value > current
            ):
                existing["rawHeatSignals"][key_name] = value
    return list(by_key.values())


def _load_ready_runs(now: datetime, lookback_days: int = 7) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    signals: list[dict[str, Any]] = []
    health: list[dict[str, Any]] = []
    cutoff = now - timedelta(days=lookback_days, hours=12)
    for feed in FEEDS:
        feed_root = INTELLIGENCE / "inbox" / feed
        feed_runs: list[tuple[datetime, Path, dict[str, Any]]] = []
        if feed_root.exists():
            for ready in feed_root.glob("*/*/READY"):
                manifest_path = ready.parent / "manifest.json"
                items_path = ready.parent / "items.json"
                if not manifest_path.exists() or not items_path.exists():
                    continue
                try:
                    manifest = load_json(manifest_path)
                    collected = parse_datetime(manifest.get("collectedAt"))
                except (OSError, json.JSONDecodeError):
                    continue
                if collected and collected >= cutoff:
                    feed_runs.append((collected, ready.parent, manifest))
        feed_runs.sort(key=lambda item: item[0], reverse=True)
        if not feed_runs:
            health.append(
                {
                    "feedId": feed,
                    "status": "MISSING",
                    "runId": None,
                    "collectedAt": None,
                    "itemCount": 0,
                    "errors": ["No READY run found in the last 7 days"],
                }
            )
            continue
        selected_runs = feed_runs[:8]
        latest_manifest = selected_runs[0][2]
        health.append(
            {
                "feedId": feed,
                "status": latest_manifest.get("status", "UNKNOWN"),
                "runId": latest_manifest.get("runId"),
                "collectedAt": latest_manifest.get("collectedAt"),
                "itemCount": sum(int(run[2].get("itemCount", 0)) for run in selected_runs),
                "errors": latest_manifest.get("errors", []),
            }
        )
        for _, run_dir, manifest in selected_runs:
            try:
                items = load_json(run_dir / "items.json")
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                signal = dict(item)
                signal["feedRunId"] = manifest.get("runId")
                signal["feedInputHash"] = manifest.get("inputHash")
                signals.append(signal)
    return _merge_duplicates(signals), health


def _signal_time(signal: dict[str, Any]) -> datetime | None:
    return parse_datetime(signal.get("publishedAt")) or parse_datetime(signal.get("discoveredAt"))


def _signals_for_window(signals: list[dict[str, Any]], now: datetime, hours: int) -> list[dict[str, Any]]:
    cutoff = now - timedelta(hours=hours)
    return [
        signal
        for signal in signals
        if (when := _signal_time(signal)) is not None and cutoff <= when <= now + timedelta(hours=2)
    ]


def _cluster_signals(signals: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    ordered = sorted(
        signals,
        key=lambda item: (
            len(item.get("provenance", [])),
            _signal_time(item) or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    clusters: list[list[dict[str, Any]]] = []
    for signal in ordered:
        best_index = -1
        best_score = 0.0
        for index, cluster in enumerate(clusters):
            score = max(_similarity(signal["title"], member["title"]) for member in cluster)
            if score > best_score:
                best_score = score
                best_index = index
        if best_index >= 0 and best_score >= 0.38:
            clusters[best_index].append(signal)
        else:
            clusters.append([signal])
    return clusters


def _classify_theme(cluster: list[dict[str, Any]]) -> str:
    text = " ".join(
        f"{item.get('category', '')} {item.get('sourceType', '')} {item.get('title', '')}"
        for item in cluster
    ).lower()
    if re.search(r"政策|监管|安全|治理|law|policy|regulat|safety", text):
        return "政策与治理"
    if re.search(r"论文|研究|arxiv|paper|research|benchmark|evaluation", text):
        return "研究与论文"
    if re.search(r"人物|观点|访谈|演讲|founder|ceo|interview|speech", text):
        return "人物观点"
    if re.search(r"agent|智能体|github|sdk|developer|开发者|代码|开源", text):
        return "Agent与开发者"
    if re.search(r"融资|投资|产业|企业|capital|funding|business|enterprise", text):
        return "产业与商业"
    if re.search(r"发布|产品|模型|release|launch|model|update", text):
        return "产品与模型"
    return "AI产业趋势"


def _pick_lead(cluster: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    def rank(signal: dict[str, Any]) -> tuple[float, float, int]:
        profile = signal["_profile"]
        authority = {"S": 5, "A": 4, "B": 3, "C": 2, "D": 0}.get(
            profile["authorityTier"], 1
        )
        published = _signal_time(signal)
        freshness = 0.0
        if published:
            freshness = max(0.0, 168 - (now - published).total_seconds() / 3600)
        heat = sum(
            math.log10(max(float(value), 0) + 1)
            for value in signal.get("rawHeatSignals", {}).values()
            if isinstance(value, (int, float))
        )
        return authority + heat, freshness, len(signal.get("summary", ""))

    return max(cluster, key=rank)


def _clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return round(min(maximum, max(minimum, value)), 1)


def _cluster_text(cluster: list[dict[str, Any]]) -> str:
    return "\n".join(
        (
            f"{item.get('title', '')}\n{item.get('summary', '')}\n"
            f"{item.get('sourceName', '')}\n{item.get('author', '') or ''}"
        )
        for item in cluster
    )


def _term_count(text: str, terms: list[str]) -> int:
    lowered = text.lower()
    return sum(1 for term in terms if str(term).lower() in lowered)


def _weighted_score(
    dimensions: dict[str, float], weights: dict[str, int]
) -> tuple[float, dict[str, dict[str, float]]]:
    breakdown: dict[str, dict[str, float]] = {}
    total = 0.0
    for name, weight in weights.items():
        raw = _clamp(dimensions.get(name, 0))
        weighted = round(raw / 100 * float(weight), 1)
        breakdown[name] = {
            "raw": raw,
            "weight": weight,
            "weighted": weighted,
        }
        total += weighted
    return round(total, 1), breakdown


def _source_identities(cluster: list[dict[str, Any]]) -> set[tuple[str, str]]:
    return {
        (
            _hostname(item.get("canonicalUrl", "")),
            str(item.get("sourceName") or item.get("author") or "").strip().lower(),
        )
        for item in cluster
        if item.get("canonicalUrl")
    }


def _source_feeds(cluster: list[dict[str, Any]]) -> set[str]:
    return {
        str(feed)
        for item in cluster
        for feed in item.get("sourceFeeds", [item.get("sourceFeed")])
        if feed
    }


def _freshness_value(cluster: list[dict[str, Any]], now: datetime) -> float:
    published = [value for item in cluster if (value := _signal_time(item)) is not None]
    age_hours = min(
        ((now - value).total_seconds() / 3600 for value in published),
        default=168,
    )
    if age_hours <= 24:
        return 100
    if age_hours <= 72:
        return 75
    return 50


def _max_summary_length(cluster: list[dict[str, Any]]) -> int:
    return max((len(str(item.get("summary", ""))) for item in cluster), default=0)


def _editorial_potential(
    cluster: list[dict[str, Any]], scoring: dict[str, Any]
) -> float:
    text = _cluster_text(cluster)
    summary_length = _max_summary_length(cluster)
    completeness = (
        90
        if summary_length >= 500
        else 78
        if summary_length >= 250
        else 62
        if summary_length >= 120
        else 52
        if summary_length >= 60
        else 40
        if summary_length >= 30
        else 20
    )
    novelty = min(100, 25 + _term_count(text, scoring["termGroups"]["novelty"]) * 15)
    human = min(100, _term_count(text, scoring["termGroups"]["humanBehavior"]) * 20)
    enterprise = min(100, _term_count(text, scoring["termGroups"]["enterprise"]) * 18)
    return _clamp(
        completeness * 0.45
        + novelty * 0.25
        + max(human, enterprise) * 0.20
        + min(100, len(cluster) * 35) * 0.10
    )


def _attention_momentum(cluster: list[dict[str, Any]]) -> tuple[float, bool]:
    best = 0.0
    observed = False
    for item in cluster:
        heat = item.get("rawHeatSignals", {})
        if isinstance(heat.get("score"), (int, float)):
            best = max(best, min(100, float(heat["score"])))
            observed = True
        engagement = sum(
            float(heat.get(key, 0))
            for key in ("likes", "retweets", "views", "comments")
            if isinstance(heat.get(key, 0), (int, float))
        )
        if engagement > 0:
            best = max(best, min(100, 20 * math.log10(engagement + 1)))
            observed = True
    return _clamp(best if observed else 20), observed


def _is_recognized_identity(text: str, scoring: dict[str, Any]) -> bool:
    voice = scoring["voiceInfluence"]
    groups = (
        voice["tierS"],
        voice["tierA"],
        voice["companyTierS"],
        voice["companyTierA"],
        voice["roleTerms"],
    )
    return any(_term_count(text, group) > 0 for group in groups)


def _is_direct_public_voice(
    item: dict[str, Any], scoring: dict[str, Any]
) -> bool:
    host = _hostname(item.get("canonicalUrl", ""))
    identity = f"{item.get('sourceName', '')} {item.get('author', '') or ''}"
    source_type = str(item.get("sourceType", "")).lower()
    public_channel = (
        host in {"x.com", "twitter.com", "youtube.com", "www.youtube.com"}
        or source_type in {"x", "twitter", "podcast", "youtube"}
    )
    return public_channel and _is_recognized_identity(identity, scoring)


def _score_hot_event(
    cluster: list[dict[str, Any]],
    now: datetime,
    scoring: dict[str, Any],
    editorial: float,
) -> tuple[float, dict[str, dict[str, float]], bool]:
    text = _cluster_text(cluster)
    groups = scoring["termGroups"]
    feeds = _source_feeds(cluster)
    published = [value for item in cluster if (value := _signal_time(item))]
    span_hours = (
        (max(published) - min(published)).total_seconds() / 3600
        if len(published) >= 2
        else 0
    )
    attention, observed_attention = _attention_momentum(cluster)
    source_velocity = (
        100
        if len(feeds) >= 3
        else 78
        if len(feeds) == 2
        else min(60, 25 + len(cluster) * 15)
    )
    sustained = (
        100
        if len(cluster) >= 3 and span_hours >= 24
        else 75
        if len(cluster) >= 2 and span_hours >= 8
        else 55
        if len(cluster) >= 2
        else 20
    )
    event_hits = _term_count(text, groups["event"])
    entity_hits = _term_count(
        text,
        scoring["voiceInfluence"]["companyTierS"]
        + scoring["voiceInfluence"]["tierS"],
    )
    event_impact = min(100, 25 + event_hits * 12 + entity_hits * 8)
    enterprise_bridge = min(
        100,
        _term_count(text, groups["enterprise"]) * 18
        + _term_count(text, groups["industry"]) * 18
        + _term_count(text, groups["agenticOS"]) * 10,
    )
    dimensions = {
        "attentionMomentum": attention,
        "sourceVelocity": source_velocity,
        "freshness": _freshness_value(cluster, now),
        "sustainedAttention": sustained,
        "eventImpact": event_impact,
        "editorialPotential": editorial,
        "enterpriseBridge": enterprise_bridge,
    }
    score, breakdown = _weighted_score(
        dimensions, scoring["tracks"]["HOT_EVENT"]["weights"]
    )
    return score, breakdown, observed_attention


def _score_public_voice(
    cluster: list[dict[str, Any]],
    now: datetime,
    scoring: dict[str, Any],
) -> tuple[float, dict[str, dict[str, float]], bool]:
    text = _cluster_text(cluster)
    identity_text = "\n".join(
        f"{item.get('sourceName', '')} {item.get('author', '') or ''}"
        for item in cluster
    )
    voice = scoring["voiceInfluence"]
    groups = scoring["termGroups"]
    identity_tier_s = _term_count(identity_text, voice["tierS"])
    identity_tier_a = _term_count(identity_text, voice["tierA"])
    identity_company_s = _term_count(identity_text, voice["companyTierS"])
    identity_company_a = _term_count(identity_text, voice["companyTierA"])
    story_person_s = _term_count(text, voice["tierS"])
    story_person_a = _term_count(text, voice["tierA"])
    story_company_s = _term_count(text, voice["companyTierS"])
    story_company_a = _term_count(text, voice["companyTierA"])
    story_tier_s = story_person_s + story_company_s
    story_tier_a = story_person_a + story_company_a
    role_hits = _term_count(identity_text, voice["roleTerms"])
    longform_voice_channel = any(
        str(item.get("sourceType", "")).lower() in {"podcast", "youtube"}
        or _hostname(item.get("canonicalUrl", ""))
        in {"youtube.com", "www.youtube.com", "youtu.be"}
        for item in cluster
    )
    speaker_influence = (
        100
        if identity_tier_s
        else 88
        if identity_tier_a
        else 90
        if longform_voice_channel and story_person_s
        else 80
        if longform_voice_channel and story_person_a
        else 82
        if identity_company_s
        else 72
        if identity_company_a or role_hits
        else 55
        if story_tier_s
        else 40
        if story_tier_a
        else 10
    )
    direct_count = sum(_is_direct_public_voice(item, scoring) for item in cluster)
    primary_count = sum(
        item["_profile"]["sourceRole"] == "primary" for item in cluster
    )
    opinion_count = sum(
        str(item.get("sourceType", "")).lower()
        in {"x", "twitter", "podcast", "youtube"}
        for item in cluster
    )
    source_directness = (
        100
        if primary_count
        else 92
        if direct_count
        else 82
        if longform_voice_channel and (story_person_s or story_person_a)
        else 72
        if opinion_count and (story_tier_s or story_tier_a)
        else 45
        if story_tier_s or story_tier_a
        else 20
    )
    summary_length = _max_summary_length(cluster)
    argument_hits = _term_count(text, groups["novelty"])
    event_hits = _term_count(text, groups["event"])
    stance_hits = _term_count(text, groups["stance"])
    viewpoint_completeness = min(
        100,
        (
            90
            if summary_length >= 500
            else 80
            if summary_length >= 250
            else 65
            if summary_length >= 120
            else 58
            if summary_length >= 60
            else 45
            if summary_length >= 30
            else 15
        )
        + min(15, argument_hits * 3),
    )
    viewpoint_novelty = min(
        100,
        35
        + argument_hits * 15
        + event_hits * 10
        + stance_hits * 8
        + _term_count(text, groups["humanBehavior"]) * 8,
    )
    audience_resonance = min(
        100,
        25
        + _term_count(text, groups["humanBehavior"]) * 15
        + _term_count(text, groups["enterprise"]) * 12
        + _term_count(text, groups["customerProblem"]) * 8,
    )
    strategic_bridge = min(
        100,
        _term_count(text, groups["enterprise"]) * 18
        + _term_count(text, groups["industry"]) * 15
        + _term_count(text, groups["agenticOS"]) * 10
        + _term_count(text, groups["humanBehavior"]) * 8
        + event_hits * 12,
    )
    dimensions = {
        "speakerInfluence": speaker_influence,
        "sourceDirectness": source_directness,
        "viewpointCompleteness": viewpoint_completeness,
        "viewpointNovelty": viewpoint_novelty,
        "audienceResonance": audience_resonance,
        "strategicBridge": strategic_bridge,
        "timeliness": _freshness_value(cluster, now),
    }
    score, breakdown = _weighted_score(
        dimensions, scoring["tracks"]["PUBLIC_VOICE"]["weights"]
    )
    identified_human_voice = bool(
        identity_tier_s
        or identity_tier_a
        or role_hits
        or (longform_voice_channel and (story_person_s or story_person_a))
    )
    identified_company_voice = bool(
        (identity_company_s or identity_company_a)
        and primary_count
        and stance_hits
    )
    eligible = (
        (identified_human_voice or identified_company_voice)
        and speaker_influence >= 70
        and source_directness >= 65
        and viewpoint_completeness >= 50
    )
    return score, breakdown, eligible


def _score_enterprise_ai(
    cluster: list[dict[str, Any]],
    scoring: dict[str, Any],
    editorial: float,
) -> tuple[float, dict[str, dict[str, float]]]:
    text = _cluster_text(cluster)
    groups = scoring["termGroups"]
    enterprise_hits = _term_count(text, groups["enterprise"])
    industry_hits = _term_count(text, groups["industry"])
    agent_hits = _term_count(text, groups["agenticOS"])
    problem_hits = _term_count(text, groups["customerProblem"])
    outcome_hits = _term_count(text, groups["businessOutcome"])
    case_hits = _term_count(text, groups["case"])
    event_hits = _term_count(text, groups["event"])
    human_hits = _term_count(text, groups["humanBehavior"])
    primary_source = any(
        item["_profile"]["sourceRole"] == "primary" for item in cluster
    )
    dimensions = {
        "enterpriseTransformation": min(
            100,
            (25 if enterprise_hits else 0)
            + min(35, industry_hits * 12)
            + min(25, agent_hits * 12)
            + min(15, case_hits * 8)
            + min(10, human_hits * 5),
        ),
        "agenticOSRelevance": min(
            100,
            agent_hits * 25
            + (10 if enterprise_hits else 0)
            + min(15, case_hits * 5),
        ),
        "customerProblemRelevance": min(
            100,
            problem_hits * 18
            + (10 if enterprise_hits else 0)
            + min(20, industry_hits * 5),
        ),
        "businessOutcomeValue": min(
            100,
            outcome_hits * 25
            + min(20, case_hits * 10)
            + (10 if problem_hits else 0),
        ),
        "caseReplicability": min(
            100,
            case_hits * 22
            + industry_hits * 12
            + (15 if primary_source else 0)
            + (15 if re.search(r"\d", text) else 0),
        ),
        "jovaStrategicBridge": min(
            100,
            agent_hits * 20
            + (15 if enterprise_hits else 0)
            + industry_hits * 8
            + problem_hits * 5,
        ),
        "editorialPotential": min(
            100,
            editorial
            + min(20, event_hits * 4)
            + min(20, case_hits * 8)
            + min(15, outcome_hits * 5),
        ),
    }
    return _weighted_score(
        dimensions, scoring["tracks"]["ENTERPRISE_AI"]["weights"]
    )


def _score_cluster(
    cluster: list[dict[str, Any]],
    theme: str,
    now: datetime,
    scoring: dict[str, Any],
) -> dict[str, Any]:
    del theme  # Track routing replaces the previous theme-wide scoring formula.
    text = _cluster_text(cluster)
    editorial = _editorial_potential(cluster, scoring)
    hot_score, hot_breakdown, observed_attention = _score_hot_event(
        cluster, now, scoring, editorial
    )
    voice_score, voice_breakdown, voice_eligible = _score_public_voice(
        cluster, now, scoring
    )
    enterprise_score, enterprise_breakdown = _score_enterprise_ai(
        cluster, scoring, editorial
    )
    track_scores = {
        "HOT_EVENT": hot_score,
        "PUBLIC_VOICE": voice_score,
        "ENTERPRISE_AI": enterprise_score,
    }
    track_breakdowns = {
        "HOT_EVENT": hot_breakdown,
        "PUBLIC_VOICE": voice_breakdown,
        "ENTERPRISE_AI": enterprise_breakdown,
    }
    if voice_eligible:
        primary_track = "PUBLIC_VOICE"
    elif enterprise_score >= hot_score and enterprise_score >= 45:
        primary_track = "ENTERPRISE_AI"
    else:
        primary_track = "HOT_EVENT"
    base_score = track_scores[primary_track]
    intersection_policy = scoring["intersectionBonus"]
    additional_tracks = sum(
        score >= float(intersection_policy["secondaryTrackThreshold"])
        for track, score in track_scores.items()
        if track != primary_track
    )
    intersection_bonus = min(
        float(intersection_policy["maximum"]),
        additional_tracks * float(intersection_policy["perAdditionalTrack"]),
    )
    preference = scoring["preferencePolicy"]
    preference_adjustment = float(
        preference.get("trackAdjustments", {}).get(primary_track, 0)
    )
    preference_adjustment = max(
        -float(preference["maximumTrackAdjustment"]),
        min(float(preference["maximumTrackAdjustment"]), preference_adjustment),
    )
    penalties: list[dict[str, Any]] = []
    groups = scoring["termGroups"]
    technical_hits = _term_count(text, groups["technicalNarrowness"])
    bridge_hits = (
        _term_count(text, groups["enterprise"])
        + _term_count(text, groups["industry"])
        + _term_count(text, groups["customerProblem"])
    )
    if technical_hits and bridge_hits == 0:
        penalties.append(
            {
                "code": "TECHNICAL_NARROWNESS",
                "value": float(
                    scoring["penalties"]["technicalNarrownessWithoutBridge"]
                ),
            }
        )
    if any(item.get("publishedAt") is None for item in cluster):
        penalties.append(
            {
                "code": "MISSING_PUBLISHED_AT",
                "value": float(scoring["penalties"]["missingPublishedAt"]),
            }
        )
    high_risk_hits = _term_count(text, groups["highRisk"])
    if high_risk_hits:
        penalties.append(
            {
                "code": "HIGH_RISK_EXPRESSION",
                "value": min(
                    12,
                    high_risk_hits
                    * float(scoring["penalties"]["highRiskExpression"]),
                ),
            }
        )
    total_penalty = sum(float(item["value"]) for item in penalties)
    topic_value_score = _clamp(
        base_score + intersection_bonus + preference_adjustment - total_penalty
    )
    return {
        "scoringVersion": scoring["schemaVersion"],
        "scoringEngineVersion": SCORING_ENGINE_VERSION,
        "primaryTrack": primary_track,
        "trackLabel": scoring["tracks"][primary_track]["label"],
        "topicValueScore": topic_value_score,
        "trackScores": track_scores,
        "trackBreakdowns": track_breakdowns,
        "intersectionBonus": round(intersection_bonus, 1),
        "preferenceAdjustment": round(preference_adjustment, 1),
        "penalties": penalties,
        "observedAttention": observed_attention,
        "editorialPotential": editorial,
    }


def _selection_title(lead: dict[str, Any], scoring: dict[str, Any]) -> tuple[str, bool]:
    title = str(lead.get("title", "")).strip()
    lowered = title.lower()
    if not any(pattern.lower() in lowered for pattern in scoring["vaguePostPatterns"]):
        return title, False
    summary = str(lead.get("summary", ""))
    candidates = [
        sentence.strip(" -•\t")
        for sentence in re.split(r"[\r\n]+|(?<=[。！？.!?])\s+", summary)
        if 30 <= len(sentence.strip()) <= 240
        and not any(
            pattern.lower() in sentence.lower()
            for pattern in scoring["vaguePostPatterns"]
        )
    ]
    if not candidates:
        return title, True
    speaker = str(lead.get("sourceName") or lead.get("author") or "").strip()
    candidate = max(candidates[:8], key=len)
    return (f"{speaker}：{candidate}" if speaker else candidate), True


def _candidate_text(
    primary_track: str,
    theme: str,
    lead: dict[str, Any],
    cluster: list[dict[str, Any]],
    scoring: dict[str, Any],
) -> dict[str, Any]:
    source_count = len(cluster)
    mapping = {
        "HOT_EVENT": (
            "从正在升温的事件中提炼对企业AI和产业变化的实际影响",
            "企业决策者、AI负责人、产业观察者",
            "优先判断事件是否改变企业AI落地条件、产业协同或智能体治理边界。",
            ["微信热点解读", "X快评", "视频解读"],
        ),
        "PUBLIC_VOICE": (
            "拆解一手公开表达中的核心判断、现实启示和适用边界",
            "企业管理者、AI从业者、Builder与知识工作者",
            "可连接企业AI、人的工作方式、组织变化及产业级Agentic OS。",
            ["微信观点文章", "X观点短帖", "短视频口播"],
        ),
        "ENTERPRISE_AI": (
            "分析企业AI进入真实经营、核心业务和组织体系的路径",
            "企业老板、业务负责人、AI负责人",
            "可连接企业AI转型、专业智能体、多智能体协同和产业级Agentic OS。",
            ["微信案例拆解", "小红书知识卡片", "视频案例解读"],
        ),
    }
    angle, audience, connection, formats = mapping[primary_track]
    if theme == "研究与论文" and primary_track != "PUBLIC_VOICE":
        angle = "判断最新研究对企业级智能体能力、成本和治理的真实意义"
    title, title_rewritten = _selection_title(lead, scoring)
    newest = max((_signal_time(item) for item in cluster if _signal_time(item)), default=None)
    when = newest.astimezone(CHINA_TZ).strftime("%m月%d日") if newest else "近期"
    if primary_track == "PUBLIC_VOICE":
        why_now = (
            f"{when}捕获到一手或可追溯人物表达，完整观点具备内容加工价值；"
            "热度不足不会自动否决长期思想价值。"
        )
    elif primary_track == "ENTERPRISE_AI":
        why_now = (
            f"{when}出现{source_count}条企业AI或产业AI信号，适合先补齐案例证据，"
            "再判断其对目标客户的可迁移性。"
        )
    else:
        why_now = (
            f"{when}出现{source_count}条可追溯事件信号；当前热度仅表示本地资讯源"
            "中的时效、重复出现与已有公开热度字段。"
        )
    return {
        "title": title,
        "sourceTitle": lead["title"],
        "titleNeedsEditorialReview": title_rewritten,
        "angle": angle,
        "whyNow": why_now,
        "targetAudience": audience,
        "jovaaiConnection": connection,
        "recommendedFormats": formats,
    }


def _evidence_assessment(
    cluster: list[dict[str, Any]], scoring: dict[str, Any]
) -> dict[str, Any]:
    identities = _source_identities(cluster)
    feeds = _source_feeds(cluster)
    primary_count = sum(
        item["_profile"]["sourceRole"] == "primary" for item in cluster
    )
    direct_count = sum(_is_direct_public_voice(item, scoring) for item in cluster)
    if len(identities) >= 2 and (
        primary_count >= 1 or direct_count >= 1 or len(feeds) >= 2
    ):
        return {
            "evidenceStatus": "SUPPORTED",
            "researchReadiness": "READY_TO_EXPAND",
            "scoreConfidence": "HIGH" if len(identities) >= 3 else "MEDIUM",
            "sourceDiversity": len(identities),
        }
    if primary_count >= 1 or direct_count >= 1 or len(identities) >= 2:
        return {
            "evidenceStatus": "PARTIAL",
            "researchReadiness": "NEEDS_CROSS_CHECK",
            "scoreConfidence": "MEDIUM",
            "sourceDiversity": len(identities),
        }
    return {
        "evidenceStatus": "LEAD_ONLY",
        "researchReadiness": "NEEDS_SOURCE_RECOVERY",
        "scoreConfidence": "LOW",
        "sourceDiversity": len(identities),
    }


def _build_candidate(
    cluster: list[dict[str, Any]],
    radar_id: str,
    date_key: str,
    window_hours: int,
    now: datetime,
    scoring: dict[str, Any],
) -> dict[str, Any] | None:
    traceable = [item for item in cluster if item.get("canonicalUrl")]
    if not traceable:
        return None
    theme = _classify_theme(cluster)
    lead = _pick_lead(cluster, now)
    scoring_result = _score_cluster(cluster, theme, now, scoring)
    score = scoring_result["topicValueScore"]
    primary_track = scoring_result["primaryTrack"]
    evidence = _evidence_assessment(cluster, scoring)
    risks: list[str] = []
    if evidence["sourceDiversity"] < 2:
        risks.append("当前只有一个独立来源，创作前必须补充交叉验证。")
    if evidence["evidenceStatus"] == "LEAD_ONLY":
        risks.append("尚未确认原始官方来源，当前资料只能支撑选题判断。")
    if any(item.get("publishedAt") is None for item in cluster):
        risks.append("部分资料缺少明确发布时间。")
    text = _candidate_text(primary_track, theme, lead, cluster, scoring)
    if text["titleNeedsEditorialReview"]:
        risks.append("原始标题上下文不足，候选标题由摘要提取，进入创作前需要人工确认。")
    supports = sorted(
        cluster,
        key=lambda item: (
            item["_profile"]["authorityTier"] == "S",
            _is_direct_public_voice(item, scoring),
            _signal_time(item) or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )[: int(scoring["seedSourceMaximum"])]
    support_sources = [
        {
            "sourceId": item["signalId"],
            "title": item["title"],
            "url": item["canonicalUrl"],
            "sourceName": item["sourceName"],
            "publishedAt": item.get("publishedAt"),
            "sourceRole": item["_profile"]["sourceRole"],
            "authorityTier": item["_profile"]["authorityTier"],
            "verificationStatus": item["_profile"]["verificationStatus"],
            "sourceFeed": item.get("sourceFeed"),
            "collectionChannels": item.get(
                "sourceFeeds", [item.get("sourceFeed")]
            ),
        }
        for item in supports
    ]
    topic_seed = {
        "date": date_key,
        "title": text["title"],
        "sourceIds": sorted(source["sourceId"] for source in support_sources),
    }
    topic_id = f"T-{date_key.replace('-', '')}-{short_hash(topic_seed, 8)}"
    field_coverage = []
    for item in supports:
        for field in ("title", "canonicalUrl", "sourceName", "publishedAt", "summary", "author"):
            field_coverage.append(bool(item.get(field)))
    data_coverage = round(sum(field_coverage) / max(len(field_coverage), 1), 2)
    candidate = {
        "topicId": topic_id,
        "radarId": radar_id,
        **text,
        "theme": theme,
        "primaryTrack": primary_track,
        "trackLabel": scoring_result["trackLabel"],
        "score": score,
        "topicValueScore": score,
        "scoreBreakdown": {
            "scoringVersion": scoring_result["scoringVersion"],
            "scoringEngineVersion": scoring_result["scoringEngineVersion"],
            "primaryTrack": primary_track,
            "trackScores": scoring_result["trackScores"],
            "primaryTrackDimensions": scoring_result["trackBreakdowns"][
                primary_track
            ],
            "intersectionBonus": scoring_result["intersectionBonus"],
            "preferenceAdjustment": scoring_result["preferenceAdjustment"],
            "penalties": scoring_result["penalties"],
            "observedAttention": scoring_result["observedAttention"],
        },
        "scoreConfidence": evidence["scoreConfidence"],
        "dataCoverage": data_coverage,
        "sourceDiversity": evidence["sourceDiversity"],
        "freshnessWindow": f"{window_hours}h",
        "collectionChannels": sorted(_source_feeds(cluster)),
        "supportSourceIds": [source["sourceId"] for source in support_sources],
        "supportSources": support_sources,
        "evidenceStatus": evidence["evidenceStatus"],
        "researchReadiness": evidence["researchReadiness"],
        "riskWarnings": risks,
        "formalEligible": score
        >= float(scoring["thresholds"]["minimumFormalCandidate"]),
        "approvalStatus": "PENDING_APPROVAL",
    }
    candidate["snapshotHash"] = sha256_value(candidate)
    return candidate


def _select_diverse(
    candidates: list[dict[str, Any]],
    maximum: int,
    minimum_track_coverage: int,
    maximum_per_track: int,
    maximum_per_theme: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    theme_counts: Counter[str] = Counter()
    track_counts: Counter[str] = Counter()
    ordered = sorted(candidates, key=lambda item: item["score"], reverse=True)

    # Seed the list with the strongest candidate from each available track.
    best_by_track: dict[str, dict[str, Any]] = {}
    for candidate in ordered:
        best_by_track.setdefault(candidate["primaryTrack"], candidate)
    track_seeds = sorted(best_by_track.values(), key=lambda item: item["score"], reverse=True)
    for candidate in track_seeds[:minimum_track_coverage]:
        selected.append(candidate)
        selected_ids.add(candidate["topicId"])
        theme_counts[candidate["theme"]] += 1
        track_counts[candidate["primaryTrack"]] += 1

    for candidate in ordered:
        if candidate["topicId"] in selected_ids:
            continue
        theme = candidate["theme"]
        track = candidate["primaryTrack"]
        if theme_counts[theme] >= maximum_per_theme:
            continue
        if track_counts[track] >= maximum_per_track:
            continue
        selected.append(candidate)
        selected_ids.add(candidate["topicId"])
        theme_counts[theme] += 1
        track_counts[track] += 1
        if len(selected) >= maximum:
            break
    return sorted(selected, key=lambda item: item["score"], reverse=True)


def _render_report(pool: dict[str, Any]) -> str:
    lines = [
        f"# AGT-RSN-004 每日选题雷达｜{pool['date']}",
        "",
        f"- Radar ID：`{pool['radarId']}`",
        f"- 实际时间窗：{pool['windowHours']} 小时",
        f"- 候选数：{len(pool['topics'])}",
        f"- 观察线索：{len(pool['observationLeads'])}",
        "",
        "## 来源健康状态",
        "",
    ]
    for health in pool["sourceHealth"]:
        lines.append(
            f"- {health['feedId']}：{health['status']}，最近运行 `{health['runId'] or '无'}`，"
            f"读取 {health['itemCount']} 条"
        )
    lines.extend(["", "## 候选选题", ""])
    if not pool["topics"]:
        lines.extend(
            [
                "当前没有通过可信门槛的选题。004 不会使用模板或虚构资料补齐数量。",
                "",
            ]
        )
    for index, topic in enumerate(pool["topics"], 1):
        track_scores = topic["scoreBreakdown"]["trackScores"]
        lines.extend(
            [
                f"### {index}. {topic['topicId']}｜{topic['title']}｜{topic['score']}分",
                "",
                f"- 主赛道：{topic['trackLabel']}（`{topic['primaryTrack']}`）",
                "- 分赛道得分："
                f"热点 {track_scores['HOT_EVENT']}；人物 {track_scores['PUBLIC_VOICE']}；"
                f"企业AI {track_scores['ENTERPRISE_AI']}",
                f"- 为什么现在值得做：{topic['whyNow']}",
                f"- 建议角度：{topic['angle']}",
                f"- 目标受众：{topic['targetAudience']}",
                f"- 与 JovaAI 的连接：{topic['jovaaiConnection']}",
                f"- 建议形式：{'、'.join(topic['recommendedFormats'])}",
                f"- 选题价值：{topic['topicValueScore']}；研究准备度："
                f"{topic['researchReadiness']}",
                f"- 证据状态：{topic['evidenceStatus']}；评分置信度：{topic['scoreConfidence']}",
                f"- 数据覆盖率：{topic['dataCoverage']:.0%}；独立来源数：{topic['sourceDiversity']}",
                f"- 采集通道：{'、'.join(topic['collectionChannels'])}",
                "- 相关资料：",
            ]
        )
        for source in topic["supportSources"]:
            published = source["publishedAt"] or "发布时间未明确"
            channel = source.get("sourceFeed") or "未标明"
            lines.append(
                f"  - [{source['title']}]({source['url']})｜原始来源："
                f"{source['sourceName']}｜采集通道：{channel}｜{published}"
            )
        if topic["riskWarnings"]:
            lines.append(f"- 风险提示：{'；'.join(topic['riskWarnings'])}")
        lines.append("")
    if len(pool["topics"]) < pool["policy"]["dailyCandidateMinimum"]:
        lines.extend(
            [
                "## 数量说明",
                "",
                f"在扩展至 {pool['windowHours']} 小时后，仅有 {len(pool['topics'])} 个选题通过可信门槛；"
                "为避免虚构或模板凑数，本次如实少报。",
                "",
            ]
        )
    lines.extend(
        [
            "## 确认方式",
            "",
            "可以回复选题 ID，例如：`T-YYYYMMDD-XXXXXXXX 进入创作`。编号只对应本报告。",
            "选题价值分只回答“值不值得研究”；研究准备度决定能否直接扩展研究包，"
            "不会用证据不足反向抹杀好选题。",
            "",
        ]
    )
    return "\n".join(lines)


def build_radar(now: datetime | None = None) -> Path:
    now = now or china_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=CHINA_TZ)
    now_utc = now.astimezone(timezone.utc)
    scoring = load_config("scoring-policy.json")
    source_policy = load_config("source-policy.json")
    signals, health = _load_ready_runs(now_utc)
    if not signals:
        raise IntelligenceError("No READY feed items are available in the last 7 days")
    for signal in signals:
        signal["_profile"] = _source_profile(signal, source_policy)

    date_key = now.astimezone(CHINA_TZ).strftime("%Y-%m-%d")
    chosen_hours = scoring["timeWindowsHours"][-1]
    chosen_signals: list[dict[str, Any]] = []
    chosen_clusters: list[list[dict[str, Any]]] = []
    for hours in scoring["timeWindowsHours"]:
        window_signals = _signals_for_window(signals, now_utc, int(hours))
        clusters = _cluster_signals(window_signals)
        provisional_candidates = [
            candidate
            for cluster in clusters
            if (
                candidate := _build_candidate(
                    cluster,
                    "RADAR-PENDING",
                    date_key,
                    int(hours),
                    now_utc,
                    scoring,
                )
            )
            is not None
            and candidate["formalEligible"]
        ]
        chosen_hours = int(hours)
        chosen_signals = window_signals
        chosen_clusters = clusters
        if len(provisional_candidates) >= int(scoring["dailyCandidateMinimum"]):
            break

    serializable_signals = [
        {key: value for key, value in signal.items() if key != "_profile"}
        for signal in chosen_signals
    ]
    input_hash = sha256_value(
        {
            "signals": sorted(
                (
                    signal["signalId"],
                    signal.get("feedRunId"),
                    signal.get("feedInputHash"),
                )
                for signal in chosen_signals
            ),
            "policy": scoring,
            "scoringEngineVersion": SCORING_ENGINE_VERSION,
        }
    )
    radar_id = f"RADAR-{date_key.replace('-', '')}-{input_hash[:10]}"
    candidate_pairs = [
        (
            cluster,
            _build_candidate(cluster, radar_id, date_key, chosen_hours, now_utc, scoring),
        )
        for cluster in chosen_clusters
    ]
    candidates = [
        candidate
        for _, candidate in candidate_pairs
        if candidate is not None and candidate["formalEligible"]
    ]
    diversity = scoring["diversity"]
    selected = _select_diverse(
        candidates,
        int(scoring["dailyCandidateMaximum"]),
        int(diversity["minimumTrackCoverage"]),
        int(diversity["maximumPerTrack"]),
        int(diversity["maximumPerTheme"]),
    )
    selected_ids = {item["topicId"] for item in selected}
    observations = [
        {
            "title": candidate["title"],
            "score": candidate["score"],
            "reason": "未进入每日候选上限或多样性约束",
            "supportSourceIds": candidate["supportSourceIds"],
        }
        for candidate in candidates
        if candidate["topicId"] not in selected_ids
    ]
    observations.extend(
        {
            "title": candidate["title"] if candidate else cluster[0]["title"],
            "score": candidate["score"] if candidate else None,
            "primaryTrack": candidate["primaryTrack"] if candidate else None,
            "evidenceStatus": candidate["evidenceStatus"] if candidate else "UNTRACEABLE",
            "reason": (
                "选题价值分未达到正式候选门槛，保留为观察线索。"
                if candidate
                else "没有可追溯URL，不能进入正式候选。"
            ),
            "supportSourceIds": (
                candidate["supportSourceIds"]
                if candidate
                else [item["signalId"] for item in cluster[:4]]
            ),
        }
        for cluster, candidate in candidate_pairs
        if (
            cluster
            and (
                candidate is None
                or not candidate["formalEligible"]
            )
        )
    )
    pool = {
        "schemaVersion": "3.0",
        "scoringVersion": scoring["schemaVersion"],
        "scoringEngineVersion": SCORING_ENGINE_VERSION,
        "radarId": radar_id,
        "date": date_key,
        "generatedAt": isoformat(now_utc),
        "windowHours": chosen_hours,
        "inputHash": input_hash,
        "sourceHealth": health,
        "policy": {
            "dailyCandidateMinimum": scoring["dailyCandidateMinimum"],
            "dailyCandidateMaximum": scoring["dailyCandidateMaximum"],
            "noTemplateBackfill": True,
            "heatMeaning": "signal_heat_only",
            "trackAware": True,
            "evidenceSeparatedFromTopicValue": True,
        },
        "topics": selected,
        "observationLeads": observations,
        "status": "READY" if selected else "NO_CREDIBLE_TOPICS",
    }
    radar_dir = INTELLIGENCE / "topic-radar" / date_key / radar_id
    pool_path = radar_dir / "topic-pool.json"
    if not pool_path.exists():
        atomic_write_json(pool_path, pool)
        atomic_write_text(radar_dir / "topic-report.md", _render_report(pool))
        atomic_write_json(
            radar_dir / "delivery-state.json",
            {
                "schemaVersion": "1.0",
                "radarId": radar_id,
                "inputHash": input_hash,
                "threadDelivered": False,
                "deliveredAt": None,
            },
        )
        normalized_path = INTELLIGENCE / "normalized" / date_key / "signals.json"
        atomic_write_json(
            normalized_path,
            {
                "schemaVersion": "1.0",
                "generatedAt": isoformat(now_utc),
                "windowHours": chosen_hours,
                "signals": serializable_signals,
            },
        )
        append_audit(
            "TOPIC_RADAR_CREATED",
            {
                "radarId": radar_id,
                "inputHash": input_hash,
                "topicCount": len(selected),
                "windowHours": chosen_hours,
            },
        )
    # READY is created only after all radar artifacts are complete. Runtime
    # consumers must ignore directories without this marker.
    atomic_write_text(radar_dir / "READY", f"{input_hash}\n")
    atomic_write_json(
        INTELLIGENCE / "topic-radar" / "latest.json",
        {
            "schemaVersion": "1.0",
            "radarId": radar_id,
            "date": date_key,
            "topicPool": str(pool_path.relative_to(INTELLIGENCE)).replace("\\", "/"),
            "topicReport": str((radar_dir / "topic-report.md").relative_to(INTELLIGENCE)).replace(
                "\\", "/"
            ),
            "inputHash": input_hash,
        },
    )
    return radar_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the local AGT-RSN-004 daily topic radar.")
    parser.add_argument(
        "--now",
        help="Optional ISO date-time for replay/testing; defaults to current time.",
    )
    args = parser.parse_args()
    now = parse_datetime(args.now) if args.now else None
    try:
        output = build_radar(now)
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"build_daily_radar failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
