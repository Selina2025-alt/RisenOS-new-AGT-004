"use client";

import type {
  ContentAsset,
  ContentMission,
  ContentVersion,
  Page,
} from "@risen/content-contracts";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { diffWords } from "diff";
import TurndownService from "turndown";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4004";
const headers = {
  "content-type": "application/json",
  "x-organization-id": "org_demo001",
  "x-user-id": "user_demo001",
  "x-role": "CREATOR",
};
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});

type View = "overview" | "create" | "library" | "review" | "governance";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `请求失败：${response.status}`);
  }
  return payload;
}

export function ContentStudio() {
  const [view, setView] = useState<View>("overview");
  const [missions, setMissions] = useState<ContentMission[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [missionPage, assetPage] = await Promise.all([
        api<Page<ContentMission>>("/v1/missions"),
        api<Page<ContentAsset>>("/v1/content-assets"),
      ]);
      setMissions(missionPage.items);
      setAssets(assetPage.items);
      setSelectedAssetId((current) => current ?? assetPage.items[0]?.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.id === selectedAssetId),
    [assets, selectedAssetId],
  );

  return (
    <div className="shell">
      <Sidebar view={view} onChange={setView} />
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">AGT‑RSN‑004 · CONTENT DOMAIN</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="top-actions">
            <span className="boundary-pill">
              <span className="status-dot" />
              无平台连接
            </span>
            <button className="button ghost" onClick={() => void load()}>
              刷新
            </button>
            <button className="button primary" onClick={() => setView("create")}>
              ＋ 新建内容任务
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice(undefined)}>×</button>
          </div>
        ) : null}

        {view === "overview" ? (
          <Overview missions={missions} assets={assets} loading={loading} />
        ) : null}
        {view === "create" ? (
          <CreateMission
            onCreated={async (runId) => {
              setNotice(`任务已创建，Run：${runId}`);
              await load();
              setView("overview");
            }}
          />
        ) : null}
        {view === "library" ? (
          <ContentLibrary
            assets={assets}
            selected={selectedAsset}
            onSelect={setSelectedAssetId}
            onSaved={load}
            onNotice={setNotice}
          />
        ) : null}
        {view === "review" ? (
          <ReviewWorkspace
            assets={assets}
            onRefresh={load}
            onNotice={setNotice}
          />
        ) : null}
        {view === "governance" ? <Governance /> : null}
      </main>
    </div>
  );
}

function Sidebar({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}) {
  const items: Array<{ id: View; icon: string; label: string }> = [
    { id: "overview", icon: "⌂", label: "内容总览" },
    { id: "create", icon: "✦", label: "内容生产" },
    { id: "library", icon: "▤", label: "内容资产库" },
    { id: "review", icon: "✓", label: "内容审核" },
    { id: "governance", icon: "◇", label: "证据与治理" },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <strong>RISEN</strong>
          <span>CONTENT STUDIO</span>
        </div>
      </div>
      <nav>
        {items.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "nav-item active" : "nav-item"}
            onClick={() => onChange(item.id)}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="scope-card">
        <span className="scope-label">职责边界</span>
        <strong>内容交付即终点</strong>
        <p>不发布、不监测、不采集平台表现。</p>
      </div>
      <div className="agent-id">
        <span className="agent-avatar">04</span>
        <div>
          <strong>Content Agent</strong>
          <small>纯内容域 · v0.1</small>
        </div>
      </div>
    </aside>
  );
}

function Overview({
  missions,
  assets,
  loading,
}: {
  missions: ContentMission[];
  assets: ContentAsset[];
  loading: boolean;
}) {
  const approved = assets.filter((item) =>
    ["APPROVED", "PACKAGED", "DELIVERED"].includes(item.status),
  ).length;
  const evidenceBlocked = missions.filter(
    (item) => item.status === "EVIDENCE_REQUIRED",
  ).length;
  return (
    <div className="content-stack">
      <section className="hero">
        <div>
          <span className="kicker">CONTENT AS AN AUDITABLE ASSET</span>
          <h2>
            从策略输入，到
            <em>可信内容资产</em>
          </h2>
          <p>
            每一个事实都有证据，每一次修改都有版本，每一份交付都能追溯。
          </p>
        </div>
        <div className="hero-orbit">
          <span>Brief</span>
          <span>Evidence</span>
          <span>Version</span>
          <b>004</b>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="内容任务" value={missions.length} note="全部任务" />
        <Metric label="内容资产" value={assets.length} note="不可变版本" />
        <Metric label="已审核" value={approved} note="可交付" tone="green" />
        <Metric
          label="证据待补"
          value={evidenceBlocked}
          note="Fail‑closed"
          tone="amber"
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">01</span>
            <h3>最近内容任务</h3>
          </div>
          <span className="muted">六阶段生产追踪</span>
        </div>
        {loading ? (
          <div className="empty">正在读取内容域数据…</div>
        ) : missions.length === 0 ? (
          <div className="empty">
            <strong>还没有内容任务</strong>
            <span>创建第一个 Mission，开始构建可审核的内容资产。</span>
          </div>
        ) : (
          <div className="mission-list">
            {missions.slice(0, 8).map((mission) => (
              <article className="mission-row" key={mission.id}>
                <div className="mission-icon">{mission.title.slice(0, 1)}</div>
                <div className="mission-copy">
                  <strong>{mission.title}</strong>
                  <span>{mission.objective}</span>
                </div>
                <div className="format-tags">
                  {mission.channels.slice(0, 3).map((channel) => (
                    <span key={channel}>{channelLabel(channel)}</span>
                  ))}
                </div>
                <Status value={mission.status} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="flow-panel">
        {["Context", "Research", "Match", "Write", "Validate", "Review"].map(
          (step, index) => (
            <div className="flow-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
              {index < 5 ? <i>→</i> : null}
            </div>
          ),
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone = "ink",
}: {
  label: string;
  value: number;
  note: string;
  tone?: "ink" | "green" | "amber";
}) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
      <small>{note}</small>
    </article>
  );
}

function CreateMission({
  onCreated,
}: {
  onCreated: (runId: string) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({
    title: "",
    objective: "",
    strategy: "",
    audience: "",
    message: "",
    contentPlan: "",
  });

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api<{ run: { id: string } }>("/v1/missions", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          audience: form.audience
            .split(/[,，\n]/)
            .map((item) => item.trim())
            .filter(Boolean),
          claims: [],
          evidence: [],
          brandRules: [],
          policies: [],
          requestedOutputs: [
            "content_brief",
            "content_research",
            "outline",
            "content",
            "content_version",
            "content_variant",
            "asset_brief",
            "answer_block",
            "content_reuse_plan",
          ],
          channels: ["wechat", "xiaohongshu", "x", "video"],
          locales: ["zh-CN"],
        }),
      });
      await onCreated(result.run.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="creation-grid" onSubmit={submit}>
      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">NEW</span>
            <h3>定义内容任务</h3>
          </div>
          <span className="muted">Mission → Brief</span>
        </div>
        <Field label="任务名称">
          <input
            required
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder="例如：2026 AI营销行业洞察"
          />
        </Field>
        <Field label="内容目标">
          <textarea
            required
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            placeholder="希望受众读完后理解、相信或采取什么行动？"
          />
        </Field>
        <div className="two-columns">
          <Field label="目标受众">
            <input
              required
              value={form.audience}
              onChange={(event) => update("audience", event.target.value)}
              placeholder="CMO，品牌负责人"
            />
          </Field>
          <Field label="核心信息">
            <input
              required
              value={form.message}
              onChange={(event) => update("message", event.target.value)}
              placeholder="只表达一个核心观点"
            />
          </Field>
        </div>
        <Field label="策略上下文">
          <textarea
            required
            value={form.strategy}
            onChange={(event) => update("strategy", event.target.value)}
            placeholder="粘贴 AGT-002 输出的策略、定位与品牌叙事"
          />
        </Field>
        <Field label="内容计划">
          <textarea
            required
            value={form.contentPlan}
            onChange={(event) => update("contentPlan", event.target.value)}
            placeholder="内容结构、交付物、渠道格式和限制"
          />
        </Field>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <span>事实 Claim 可在 API 中随 Evidence 一并提交</span>
          <button className="button primary" disabled={submitting}>
            {submitting ? "创建中…" : "创建任务"}
          </button>
        </div>
      </section>

      <aside className="creation-aside">
        <div className="aside-card dark">
          <span>默认输出</span>
          <strong>9 类内容资产</strong>
          <ul>
            <li>Brief / Research / Outline</li>
            <li>主内容与不可变版本</li>
            <li>微信 / 小红书 / X / 视频变体</li>
            <li>视觉简报与 AnswerBlock</li>
            <li>ContentReusePlan</li>
          </ul>
        </div>
        <div className="aside-card">
          <span>安全门</span>
          <strong>未验证事实，不进入审核</strong>
          <p>系统不会用搜索摘要、模型常识或示例数据替代正式 Evidence。</p>
        </div>
      </aside>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ContentLibrary({
  assets,
  selected,
  onSelect,
  onSaved,
  onNotice,
}: {
  assets: ContentAsset[];
  selected: ContentAsset | undefined;
  onSelect: (id: string) => void;
  onSaved: () => Promise<void>;
  onNotice: (value: string) => void;
}) {
  const [body, setBody] = useState(selected?.bundle.primary.body ?? "");
  const [richBody, setRichBody] = useState(
    plainTextToHtml(selected?.bundle.primary.body ?? ""),
  );
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  useEffect(() => {
    setBody(selected?.bundle.primary.body ?? "");
    if (selected) {
      void api<ContentVersion[]>(
        `/v1/content-assets/${selected.id}/versions`,
      ).then((items) => {
        setVersions(items);
        const current = items.at(-1);
        setRichBody(
          current?.richBody ?? plainTextToHtml(current?.body ?? selected.bundle.primary.body),
        );
      }).catch((error) => onNotice(String(error)));
    } else {
      setVersions([]);
    }
  }, [selected, onNotice]);

  const previousVersion =
    versions.length > 1 ? versions[versions.length - 2] : undefined;
  const diff = previousVersion ? diffWords(previousVersion.body, body) : [];

  async function saveVersion() {
    if (!selected) return;
    await api(`/v1/content-assets/${selected.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        title: selected.bundle.primary.title,
        body,
        bodyFormat: "tiptap_html",
        richBody,
        changeReason: "工作台人工编辑",
      }),
    });
    onNotice("已创建新的不可变内容版本，原审核状态已失效。");
    await onSaved();
  }

  return (
    <div className="library-layout">
      <section className="asset-list panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">LIB</span>
            <h3>内容资产</h3>
          </div>
          <span className="muted">{assets.length} 项</span>
        </div>
        {assets.length === 0 ? (
          <div className="empty">暂无内容资产</div>
        ) : (
          assets.map((asset) => (
            <button
              key={asset.id}
              className={selected?.id === asset.id ? "asset-row active" : "asset-row"}
              onClick={() => onSelect(asset.id)}
            >
              <span className="asset-symbol">{asset.title.slice(0, 1)}</span>
              <span>
                <strong>{asset.title}</strong>
                <small>v{asset.versionIds.length} · {asset.bundle.primary.channel}</small>
              </span>
              <Status value={asset.status} compact />
            </button>
          ))
        )}
      </section>
      <section className="editor panel">
        {selected ? (
          <>
            <div className="panel-heading">
              <div>
                <span className="section-index">EDIT</span>
                <h3>{selected.title}</h3>
              </div>
              <Status value={selected.status} />
            </div>
            <div className="editor-meta">
              <span>当前版本 v{selected.versionIds.length}</span>
              <span>{selected.bundle.primary.locale}</span>
              <span>{selected.bundle.primary.channel}</span>
            </div>
            <RichTextEditor
              key={selected.id}
              value={body}
              richValue={richBody}
              onChange={(text, html) => {
                setBody(text);
                setRichBody(html);
              }}
            />
            {previousVersion ? (
              <details className="version-diff">
                <summary>与 v{previousVersion.versionNumber} 对比</summary>
                <div>
                  {diff.map((part, index) => (
                    <span
                      key={`${index}-${part.value.slice(0, 8)}`}
                      className={
                        part.added ? "diff-added" : part.removed ? "diff-removed" : ""
                      }
                    >
                      {part.value}
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
            <div className="editor-actions">
              <span>保存会创建新版本，不覆盖历史内容。</span>
              <button className="button primary" onClick={() => void saveVersion()}>
                保存为新版本
              </button>
            </div>
          </>
        ) : (
          <div className="empty">选择一项内容资产开始编辑</div>
        )}
      </section>
    </div>
  );
}

function RichTextEditor({
  value,
  richValue,
  onChange,
}: {
  value: string;
  richValue: string;
  onChange: (value: string, richValue: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: richValue || plainTextToHtml(value),
    immediatelyRender: false,
    onUpdate: ({ editor: current }) =>
      onChange(
        turndown.turndown(current.getHTML()),
        current.getHTML(),
      ),
  });
  useEffect(() => {
    if (editor && richValue && editor.getHTML() !== richValue) {
      editor.commands.setContent(richValue, { emitUpdate: false });
    }
  }, [editor, richValue]);
  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()}>
          粗体
        </button>
        <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          二级标题
        </button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          列表
        </button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
          引用
        </button>
      </div>
      <EditorContent editor={editor} className="document-editor" />
    </div>
  );
}

function plainTextToHtml(value: string): string {
  return value
    .split(/\r?\n\r?\n/)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

function Governance() {
  const controls = [
    ["Claim / Evidence", "每个事实 Claim 必须绑定已验证且权利清晰的 Evidence。"],
    ["Immutable Version", "人工编辑和模型重写一律创建新版本，历史版本不可覆盖。"],
    ["Human Review", "PublicStatement、高风险内容与背书内容强制人工审核。"],
    ["Content-only Boundary", "内容包不含账号、凭据、发布时间、发布状态和效果指标。"],
  ];
  return (
    <div className="governance-grid">
      <section className="panel governance-intro">
        <span className="kicker">FAIL‑CLOSED BY DESIGN</span>
        <h2>质量不是一个分数，<br />而是一组不可绕过的门。</h2>
        <p>
          AGT‑004 只交付能够解释“从哪里来、为什么可信、谁审核过”的内容资产。
        </p>
      </section>
      {controls.map(([title, copy], index) => (
        <article className="control-card" key={title}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{title}</strong>
          <p>{copy}</p>
        </article>
      ))}
    </div>
  );
}

function ReviewWorkspace({
  assets,
  onRefresh,
  onNotice,
}: {
  assets: ContentAsset[];
  onRefresh: () => Promise<void>;
  onNotice: (value: string) => void;
}) {
  const candidates = assets.filter((asset) =>
    ["REVIEW_REQUIRED", "REVISION_REQUIRED", "APPROVED"].includes(asset.status),
  );
  const [workingId, setWorkingId] = useState<string>();
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  async function decide(
    asset: ContentAsset,
    decision: "APPROVED" | "CHANGES_REQUESTED",
  ) {
    setWorkingId(asset.id);
    try {
      let reviewId = asset.activeReviewId;
      if (!reviewId) {
        const review = await api<{ id: string }>("/v1/reviews", {
          method: "POST",
          body: JSON.stringify({
            assetId: asset.id,
            versionId: asset.currentVersionId,
            reviewerType: "HUMAN",
            reviewerId: "reviewer_demo001",
            notes: "工作台人工审核",
          }),
        });
        reviewId = review.id;
      }
      await api("/v1/review-decisions", {
        method: "POST",
        headers: {
          "x-user-id": "reviewer_demo001",
          "x-role": "REVIEWER",
        },
        body: JSON.stringify({
          reviewId,
          decision,
          reviewerId: "reviewer_demo001",
          summary:
            reviewNotes[asset.id]?.trim() ||
            (decision === "APPROVED"
              ? "人工确认内容、证据、品牌和政策检查均通过。"
              : "审核人要求修改当前内容版本。"),
          comments: reviewNotes[asset.id]?.trim()
            ? [
                {
                  path: "body",
                  message: (reviewNotes[asset.id] ?? "").trim(),
                  severity:
                    decision === "APPROVED" ? "INFO" : "ERROR",
                },
              ]
            : [],
        }),
      });
      onNotice(
        decision === "APPROVED"
          ? "内容已批准，可以生成 ContentPackage。"
          : "已提交修改要求和审核意见。",
      );
      await onRefresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingId(undefined);
    }
  }

  async function packageContent(asset: ContentAsset) {
    setWorkingId(asset.id);
    try {
      const value = await api<{ id: string }>("/v1/content-packages", {
        method: "POST",
        body: JSON.stringify({
          contentAssetId: asset.id,
          versionId: asset.currentVersionId,
          generatedAssetIds: [],
        }),
      });
      onNotice(`ContentPackage 已生成：${value.id}`);
      await onRefresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingId(undefined);
    }
  }

  return (
    <section className="review-board">
      <div className="review-intro">
        <div>
          <span className="kicker">INDEPENDENT REVIEW</span>
          <h2>审核内容，不审核自己。</h2>
        </div>
        <p>
          生成者提交审核；Reviewer 使用独立身份作出决定。批准绑定具体版本，
          任何修改都会使批准失效。
        </p>
      </div>
      {candidates.length === 0 ? (
        <div className="panel empty">当前没有待审核内容</div>
      ) : (
        <div className="review-list">
          {candidates.map((asset) => (
            <article className="review-card" key={asset.id}>
              <div className="review-card-top">
                <span className="asset-symbol">{asset.title.slice(0, 1)}</span>
                <div>
                  <strong>{asset.title}</strong>
                  <small>
                    v{asset.versionIds.length} · {asset.bundle.primary.channel} ·{" "}
                    {asset.bundle.primary.locale}
                  </small>
                </div>
                <Status value={asset.status} />
              </div>
              <p>{asset.bundle.primary.summary}</p>
              <div className="review-facts">
                <span>{asset.bundle.primary.claimIdsUsed.length} Claims</span>
                <span>{asset.bundle.variants.length} Variants</span>
                <span>{asset.bundle.assetBriefs.length} Asset Briefs</span>
              </div>
              <div className="review-actions">
                {asset.status === "APPROVED" ? (
                  <button
                    className="button primary"
                    disabled={workingId === asset.id}
                    onClick={() => void packageContent(asset)}
                  >
                    生成内容包
                  </button>
                ) : (
                  <>
                    <textarea
                      aria-label="审核意见"
                      value={reviewNotes[asset.id] ?? ""}
                      onChange={(event) =>
                        setReviewNotes((current) => ({
                          ...current,
                          [asset.id]: event.target.value,
                        }))
                      }
                      placeholder="填写段落、Claim 或品牌问题；要求修改时建议必填"
                    />
                    <button
                      className="button ghost"
                      disabled={workingId === asset.id}
                      onClick={() => void decide(asset, "CHANGES_REQUESTED")}
                    >
                      要求修改
                    </button>
                    <button
                      className="button primary"
                      disabled={workingId === asset.id}
                      onClick={() => void decide(asset, "APPROVED")}
                    >
                      人工批准当前版本
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Status({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  return (
    <span className={`status ${statusTone(value)} ${compact ? "compact" : ""}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function statusTone(value: string) {
  if (["APPROVED", "PACKAGED", "DELIVERED"].includes(value)) return "success";
  if (["FAILED", "REVISION_REQUIRED"].includes(value)) return "danger";
  if (value === "EVIDENCE_REQUIRED") return "warning";
  return "neutral";
}

function viewTitle(view: View) {
  return {
    overview: "内容资产总览",
    create: "创建内容任务",
    library: "内容资产库",
    review: "内容审核",
    governance: "证据与内容治理",
  }[view];
}

function channelLabel(channel: string) {
  return {
    generic: "通用",
    web: "网站",
    wechat: "微信格式",
    xiaohongshu: "小红书格式",
    x: "X 格式",
    video: "视频脚本",
  }[channel] ?? channel;
}
