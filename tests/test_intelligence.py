from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import build_daily_radar
import approve_topic
import create_research_mission
import feed_writer
import research_pack
import record_topic_feedback
from intelligence_common import canonicalize_url, guard_public_query, load_config


class IntelligenceSafetyTests(unittest.TestCase):
    def test_canonical_url_removes_tracking(self) -> None:
        canonical, status = canonicalize_url(
            "https://Example.com/news/item/?utm_source=test&id=7#section"
        )
        self.assertEqual(status, "traceable")
        self.assertEqual(canonical, "https://example.com/news/item?id=7")

    def test_private_and_unsafe_urls_are_rejected(self) -> None:
        for url in (
            "file:///C:/secret.txt",
            "http://127.0.0.1/admin",
            "http://10.0.0.5/internal",
            "javascript:alert(1)",
        ):
            with self.subTest(url=url):
                canonical, status = canonicalize_url(url)
                self.assertEqual(canonical, "")
                self.assertEqual(status, "rejected")

    def test_public_query_guard_blocks_confidential_content(self) -> None:
        allowed, reasons = guard_public_query("产业级 Agentic OS 最新政策")
        self.assertTrue(allowed)
        self.assertEqual(reasons, [])
        blocked, reasons = guard_public_query("未公开路线图 内部版")
        self.assertFalse(blocked)
        self.assertTrue(reasons)

    def test_each_track_scoring_weights_total_one_hundred(self) -> None:
        scoring = load_config("scoring-policy.json")
        self.assertEqual(scoring["scoringMode"], "track-aware-v3")
        self.assertEqual(
            set(scoring["tracks"]),
            {"HOT_EVENT", "PUBLIC_VOICE", "ENTERPRISE_AI"},
        )
        for track in scoring["tracks"].values():
            self.assertEqual(sum(track["weights"].values()), 100)
        self.assertFalse(scoring["preferencePolicy"]["automaticWeightMutation"])


class TopicTrackScoringTests(unittest.TestCase):
    def _signal(
        self,
        *,
        title: str,
        summary: str,
        source_name: str,
        source_type: str = "x",
        url: str = "https://x.com/example/status/1",
        likes: int = 0,
    ) -> dict:
        return {
            "signalId": "SIG-TEST",
            "title": title,
            "summary": summary,
            "sourceName": source_name,
            "author": source_name,
            "sourceType": source_type,
            "sourceFeed": "follow-builders",
            "sourceFeeds": ["follow-builders"],
            "canonicalUrl": url,
            "publishedAt": "2026-07-30T01:00:00+00:00",
            "discoveredAt": "2026-07-30T02:00:00+00:00",
            "rawHeatSignals": {"likes": likes} if likes else {},
            "_profile": {
                "sourceRole": "opinion",
                "authorityTier": "B",
                "verificationStatus": "metadata_only",
            },
        }

    def test_complete_enterprise_voice_routes_to_public_voice(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="Aaron Levie：企业 Agent 需要新的安全和治理体系",
            summary=(
                "企业 agent 的扩散速度会被安全和治理现实重新校准。"
                "企业需要重新设计数据边界、审计轨迹、访问控制、确定性系统和紧急阻断机制。"
                "机会不只是让 agent 更聪明，而是让 agent 在企业环境里可控、可追责、可隔离。"
            ),
            source_name="Aaron Levie",
            url="https://x.com/levie/status/1",
            likes=1200,
        )
        result = build_daily_radar._score_cluster(
            [signal],
            "人物观点",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "PUBLIC_VOICE")
        self.assertGreaterEqual(result["topicValueScore"], 70)
        self.assertGreater(
            result["trackScores"]["PUBLIC_VOICE"],
            result["trackScores"]["HOT_EVENT"],
        )

    def test_vague_post_title_uses_complete_summary_for_scoring(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="Sam Altman：so excited for this",
            summary=(
                "We are very close to models that significantly accelerate scientific discovery. "
                "The best path is to empower scientists and experts, not to replace them or have "
                "AI companies solve everything themselves. This changes how AI products should be built."
            ),
            source_name="Sam Altman",
            url="https://x.com/sama/status/1",
            likes=3000,
        )
        result = build_daily_radar._score_cluster(
            [signal],
            "人物观点",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        title, needs_review = build_daily_radar._selection_title(signal, scoring)
        self.assertEqual(result["primaryTrack"], "PUBLIC_VOICE")
        self.assertGreaterEqual(result["topicValueScore"], 65)
        self.assertTrue(needs_review)
        self.assertNotEqual(title, signal["title"])

    def test_company_product_blog_is_not_misclassified_as_human_voice(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="OpenAI 发布新模型并改善价格性能",
            summary=(
                "OpenAI announced a new model with lower cost and stronger benchmark results "
                "for enterprise developers and production applications."
            ),
            source_name="OpenAI Blog",
            source_type="official",
            url="https://openai.com/index/model-update/",
        )
        signal["_profile"]["sourceRole"] = "primary"
        signal["_profile"]["authorityTier"] = "S"
        result = build_daily_radar._score_cluster(
            [signal],
            "产品与模型",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertNotEqual(result["primaryTrack"], "PUBLIC_VOICE")

    def test_official_company_stance_can_route_to_public_voice(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="OpenAI 呼吁为前沿 AI 设定安全发展节奏",
            summary=(
                "OpenAI 认为前沿 AI 企业应该建立可验证的安全标准，并呼吁行业支持"
                "透明审计和负责任部署。这一主张直接影响企业采用和治理判断。"
            ),
            source_name="OpenAI",
            source_type="official",
            url="https://openai.com/index/responsible-frontier-ai/",
        )
        signal["_profile"]["sourceRole"] = "primary"
        signal["_profile"]["authorityTier"] = "S"
        result = build_daily_radar._score_cluster(
            [signal],
            "名企观点",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "PUBLIC_VOICE")

    def test_named_thinker_in_podcast_can_route_to_public_voice(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="Kevin Kelly on Why AI Is a 50-year Overnight Success",
            summary=(
                "Kevin Kelly argues that important technologies accumulate for decades before "
                "they look like an overnight success. He compares AI with early electricity and "
                "suggests intelligence may be a compound whose components we still do not understand. "
                "Builders should study history, infrastructure, governance and long-term invariants."
            ),
            source_name="AI & I by Every",
            source_type="youtube",
            url="https://www.youtube.com/watch?v=example",
        )
        result = build_daily_radar._score_cluster(
            [signal],
            "人物观点",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "PUBLIC_VOICE")
        self.assertGreaterEqual(result["topicValueScore"], 55)

    def test_influential_founder_action_has_public_voice_value(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="Andrew Ng 创办 LearnVector，用 AI 实现一对一学习",
            summary=(
                "Andrew Ng 宣布创办 AI 教育公司 LearnVector，旨在把学习从一对多转变为"
                "一对一。平台将利用 AI 定制学习路径，提供准确可信的个性化学习体验。"
            ),
            source_name="Andrew Ng",
            url="https://x.com/AndrewYNg/status/1",
            likes=1000,
        )
        result = build_daily_radar._score_cluster(
            [signal],
            "人物观点",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "PUBLIC_VOICE")
        self.assertGreaterEqual(result["topicValueScore"], 70)

    def test_rising_multi_source_event_routes_to_hot_event(self) -> None:
        scoring = load_config("scoring-policy.json")
        first = self._signal(
            title="企业 AI Agent 采用率快速上升",
            summary=(
                "A new enterprise AI agent adoption report is trending after a major launch, "
                "with discussion and demand continuing to rise."
            ),
            source_name="Industry Report",
            source_type="report",
            url="https://example.com/report/agent-adoption",
            likes=8000,
        )
        second = self._signal(
            title="企业智能体采用增长成为行业热点",
            summary="Multiple companies report rapid growth in enterprise agent adoption.",
            source_name="Business News",
            source_type="news",
            url="https://news.example.com/enterprise-agent-growth",
            likes=3000,
        )
        second["signalId"] = "SIG-TEST-2"
        second["sourceFeed"] = "aihot"
        second["sourceFeeds"] = ["aihot"]
        result = build_daily_radar._score_cluster(
            [first, second],
            "AI产业趋势",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "HOT_EVENT")

    def test_enterprise_ai_case_routes_to_enterprise_track(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="亚马逊用百万机器人重塑物流运营",
            summary=(
                "亚马逊把 AI、智能体和机器人融入仓储、物流、供应链和运营体系，"
                "形成可规模化复制的企业 AI 转型案例，并改善效率、成本和交付结果。"
            ),
            source_name="Amazon",
            source_type="official",
            url="https://www.aboutamazon.com/news/operations/robotics",
        )
        signal["_profile"]["sourceRole"] = "primary"
        signal["_profile"]["authorityTier"] = "A"
        result = build_daily_radar._score_cluster(
            [signal],
            "企业AI案例",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        self.assertEqual(result["primaryTrack"], "ENTERPRISE_AI")
        self.assertGreaterEqual(result["topicValueScore"], 70)

    def test_narrow_technical_topic_receives_bridge_penalty(self) -> None:
        scoring = load_config("scoring-policy.json")
        signal = self._signal(
            title="CUDA Kernel benchmark 发布",
            summary="A CUDA kernel parameter benchmark with a new attention architecture.",
            source_name="arXiv",
            source_type="paper",
            url="https://arxiv.org/abs/2607.00001",
        )
        signal["_profile"]["sourceRole"] = "primary"
        signal["_profile"]["authorityTier"] = "S"
        result = build_daily_radar._score_cluster(
            [signal],
            "研究与论文",
            datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc),
            scoring,
        )
        penalty_codes = {item["code"] for item in result["penalties"]}
        self.assertIn("TECHNICAL_NARROWNESS", penalty_codes)


class FeedAndRadarTests(unittest.TestCase):
    def _payload(self, feed: str, now: datetime) -> dict:
        topics = [
            ("OpenAI Agent 企业应用更新", "https://openai.com/news/agents-enterprise"),
            ("Anthropic 发布企业智能体安全能力", "https://anthropic.com/news/agent-safety"),
            ("Google 多智能体研究进入产业应用", "https://deepmind.google/research/multi-agent"),
            ("GitHub 推出 Agent 开发工具", "https://github.blog/ai-and-ml/agent-tools"),
            ("arXiv 企业 AI Agent 评估论文", "https://arxiv.org/abs/2607.00001"),
            ("中国企业智能体政策与治理新要求", "https://www.gov.cn/zhengce/agent-policy"),
        ]
        source_names = {
            "aihot": "OpenAI",
            "agentreach": "Anthropic",
            "follow-builders": "GitHub",
        }
        items = []
        for index, (title, url) in enumerate(topics):
            items.append(
                {
                    "id": f"{feed}-{index}",
                    "title": title,
                    "url": url,
                    "source": source_names[feed] if index == 0 else url.split("/")[2],
                    "publishedAt": (now - timedelta(hours=index + 1)).isoformat(),
                    "summary": f"{title} 的公开资料摘要，讨论企业 AI、产业 AI 和智能体落地。",
                    "category": "industry",
                    "score": 80 - index,
                }
            )
        return {"items": items}

    def test_feed_writer_and_radar_are_idempotent(self) -> None:
        now = datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            intelligence = Path(temp) / "intelligence"
            audit_events: list[tuple[str, dict]] = []
            with (
                patch.object(feed_writer, "INTELLIGENCE", intelligence),
                patch.object(build_daily_radar, "INTELLIGENCE", intelligence),
                patch.object(
                    build_daily_radar,
                    "append_audit",
                    lambda event, payload: audit_events.append((event, payload)),
                ),
            ):
                for feed in ("aihot", "agentreach", "follow-builders"):
                    run_dir = feed_writer.write_feed_run(
                        feed_id=feed,
                        payload=self._payload(feed, now),
                        window_start=(now - timedelta(hours=24)).isoformat(),
                        window_end=now.isoformat(),
                        collected_at=now.isoformat(),
                        digest_text=None,
                    )
                    self.assertTrue((run_dir / "READY").exists())
                    self.assertTrue((run_dir / "manifest.json").exists())
                    self.assertTrue((run_dir / "items.json").exists())

                radar_dir = build_daily_radar.build_radar(now)
                second = build_daily_radar.build_radar(now)
                self.assertEqual(radar_dir, second)
                pool = json.loads((radar_dir / "topic-pool.json").read_text(encoding="utf-8"))
                self.assertGreater(len(pool["topics"]), 0)
                self.assertLessEqual(len(pool["topics"]), 8)
                self.assertTrue(all(topic["supportSources"] for topic in pool["topics"]))
                self.assertTrue(all(topic["formalEligible"] for topic in pool["topics"]))
                self.assertTrue(all(topic["primaryTrack"] for topic in pool["topics"]))
                self.assertEqual(len(audit_events), 1)

    def test_feed_writer_redacts_credentials_in_summary(self) -> None:
        now = datetime(2026, 7, 30, 2, 0, tzinfo=timezone.utc)
        payload = {
            "items": [
                {
                    "title": "企业 AI Agent 新闻",
                    "url": "https://example.com/news",
                    "summary": "password=super-secret-value",
                    "publishedAt": now.isoformat(),
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temp:
            intelligence = Path(temp) / "intelligence"
            with patch.object(feed_writer, "INTELLIGENCE", intelligence):
                run_dir = feed_writer.write_feed_run(
                    feed_id="aihot",
                    payload=payload,
                    window_start=(now - timedelta(hours=24)).isoformat(),
                    window_end=now.isoformat(),
                    collected_at=now.isoformat(),
                    digest_text=None,
                )
                stored = json.loads((run_dir / "items.json").read_text(encoding="utf-8"))
                self.assertIn("[REDACTED_SECRET]", stored[0]["summary"])
                self.assertNotIn("super-secret-value", stored[0]["summary"])


class ApprovalAndResearchTests(unittest.TestCase):
    def test_approval_creates_immutable_mission(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            intelligence = root / "intelligence"
            topic = {
                "topicId": "T-20260730-TEST0001",
                "radarId": "RADAR-TEST",
                "title": "企业智能体安全边界",
                "angle": "从公开事件分析授权和行为围栏",
                "targetAudience": "企业管理者",
                "score": 80,
            }
            from intelligence_common import sha256_value

            topic["snapshotHash"] = sha256_value(topic)
            pool_dir = intelligence / "topic-radar" / "2026-07-30" / "RADAR-TEST"
            pool_dir.mkdir(parents=True)
            (pool_dir / "topic-pool.json").write_text(
                json.dumps({"radarId": "RADAR-TEST", "topics": [topic]}, ensure_ascii=False),
                encoding="utf-8",
            )
            with (
                patch.object(approve_topic, "ROOT", root),
                patch.object(approve_topic, "INTELLIGENCE", intelligence),
                patch.object(approve_topic, "append_audit", lambda *_: None),
                patch.object(create_research_mission, "ROOT", root),
                patch.object(create_research_mission, "append_audit", lambda *_: None),
            ):
                mission_dir = approve_topic.record_decision(
                    topic_id=topic["topicId"],
                    action="approve",
                )
            mission = json.loads((mission_dir / "mission.json").read_text(encoding="utf-8"))
            self.assertEqual(mission["originTopic"]["snapshotHash"], topic["snapshotHash"])
            self.assertEqual(mission["status"], "RESEARCH_REQUIRED")
            self.assertTrue((mission_dir / "content-brief.json").exists())

    def test_research_pack_requires_evidence_and_builds_brief(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            intelligence = root / "intelligence"
            mission_id = "MISSION-20260730-TESTPACK"
            mission_dir = root / "missions" / mission_id
            mission_dir.mkdir(parents=True)
            mission = {"missionId": mission_id, "topic": "企业智能体研究"}
            brief = {
                "briefId": "BRIEF-TEST",
                "missionId": mission_id,
                "status": "PENDING_RESEARCH",
            }
            (mission_dir / "mission.json").write_text(
                json.dumps(mission, ensure_ascii=False), encoding="utf-8"
            )
            (mission_dir / "content-brief.json").write_text(
                json.dumps(brief, ensure_ascii=False), encoding="utf-8"
            )
            sources = []
            source_types = ("official", "paper", "article")
            for index in range(8):
                sources.append(
                    {
                        "sourceId": f"SRC-{index + 1}",
                        "title": f"公开来源 {index + 1}",
                        "url": f"https://example{index}.com/source",
                        "sourceType": source_types[index % len(source_types)],
                        "sourceRole": "primary" if index < 2 else "secondary",
                        "authorityTier": "S" if index < 2 else "B",
                        "verificationStatus": "verified",
                        "summary": "公开资料摘要",
                    }
                )
            payload = {
                "sources": sources,
                "claims": [
                    {
                        "statement": "该公开事件表明企业智能体需要清晰授权边界。",
                        "claimType": "factual",
                        "sourceIds": ["SRC-1", "SRC-2"],
                    }
                ],
                "evidenceGaps": [],
            }
            input_path = root / "materials.json"
            input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with (
                patch.object(research_pack, "ROOT", root),
                patch.object(research_pack, "INTELLIGENCE", intelligence),
                patch.object(research_pack, "append_audit", lambda *_: None),
            ):
                output = research_pack.build_research_pack(mission_id, input_path)
            pack = json.loads((output / "research-pack.json").read_text(encoding="utf-8"))
            self.assertEqual(pack["status"], "RESEARCH_READY")
            self.assertEqual(pack["metrics"]["validSourceCount"], 8)
            briefs = list(mission_dir.glob("content-brief-*.json"))
            self.assertEqual(len(briefs), 1)
            built_brief = json.loads(briefs[0].read_text(encoding="utf-8"))
            self.assertEqual(built_brief["status"], "READY")

    def test_topic_feedback_is_immutable_and_does_not_mutate_weights(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            intelligence = root / "intelligence"
            topic = {
                "topicId": "T-20260730-FEEDBACK",
                "radarId": "RADAR-FEEDBACK",
                "title": "企业 Agent 安全治理",
                "primaryTrack": "PUBLIC_VOICE",
                "topicValueScore": 82,
            }
            from intelligence_common import sha256_value

            topic["snapshotHash"] = sha256_value(topic)
            pool_dir = (
                intelligence
                / "topic-radar"
                / "2026-07-30"
                / "RADAR-FEEDBACK"
            )
            pool_dir.mkdir(parents=True)
            (pool_dir / "topic-pool.json").write_text(
                json.dumps(
                    {"radarId": "RADAR-FEEDBACK", "topics": [topic]},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with (
                patch.object(approve_topic, "INTELLIGENCE", intelligence),
                patch.object(record_topic_feedback, "INTELLIGENCE", intelligence),
                patch.object(record_topic_feedback, "append_audit", lambda *_: None),
            ):
                output = record_topic_feedback.record_feedback(
                    topic_id=topic["topicId"],
                    decision="select",
                    reason_tags=["企业AI", "一手人物表达"],
                    preferred_rank=1,
                )
                second = record_topic_feedback.record_feedback(
                    topic_id=topic["topicId"],
                    decision="select",
                    reason_tags=["一手人物表达", "企业AI"],
                    preferred_rank=1,
                )
            self.assertEqual(output, second)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertFalse(payload["automaticWeightMutation"])
            self.assertEqual(payload["preferredRank"], 1)
            self.assertEqual(
                payload["reasonTags"],
                ["一手人物表达", "企业AI"],
            )


if __name__ == "__main__":
    unittest.main()
