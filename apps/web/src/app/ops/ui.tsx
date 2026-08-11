"use client";

import { useEffect, useState, useTransition } from "react";
import styles from "./ops.module.css";

type Idea = {
  id: string;
  status: string;
  platform: string;
  hook: string;
  content: string;
  error?: string | null;
  zernioPlatformUrl?: string | null;
};

type Dashboard = {
  ok: boolean;
  day?: string;
  prospectFunnel?: {
    uniquePhonesMessagedToday: number;
    inboundMessagesToday: number;
    leadsCreatedToday: number;
    funnelStages: Record<string, number>;
    aiCallsToday: number;
    aiCostUsdToday: number;
  };
  internalOps?: {
    uniquePhonesMessagedToday: number;
    inboundMessagesToday: number;
    operatorPhones: string[];
    aiCallsToday: number;
    aiCostUsdToday: number;
  };
  leadFlowByDay?: Array<{ day: string; uniquePhones: number }>;
  costPerLeadUsd?: number | null;
  prospectAiCostUsdToday?: number;
  postingQueue?: Idea[];
  recentReviews?: Array<{
    id: string;
    phone?: string | null;
    severity: string;
    findings: string;
    missedOpportunity: boolean;
    createdAt: string;
  }>;
  leadGenDrafts?: Array<{
    id: string;
    channel: string;
    hook: string;
    body: string;
    cta?: string | null;
    status: string;
  }>;
};

export function OpsDashboardClient(props: {
  apiBase: string;
  secret: string;
  initial: Dashboard;
}) {
  const [data, setData] = useState(props.initial);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    document.cookie = `altered_ops_key=${encodeURIComponent(props.secret)}; path=/ops; max-age=604800; SameSite=Lax`;
  }, [props.secret]);

  async function refresh() {
    const res = await fetch(
      `${props.apiBase}/ops/dashboard?key=${encodeURIComponent(props.secret)}`,
      { cache: "no-store" },
    );
    if (res.ok) setData(await res.json());
  }

  async function act(ideaId: string, action: string) {
    startTransition(async () => {
      await fetch(`${props.apiBase}/ops/posts/idea/${ideaId}/action`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${props.secret}`,
        },
        body: JSON.stringify({ action, note: note || undefined }),
      });
      await refresh();
    });
  }

  const pf = data.prospectFunnel;
  const ops = data.internalOps;
  const stages = pf?.funnelStages ?? {};

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>INTERNAL</p>
          <h1>ALTERED Ops</h1>
        </div>
        <button className={styles.btn} type="button" onClick={() => refresh()} disabled={pending}>
          Refresh
        </button>
      </header>

      <section className={styles.grid2}>
        <div className={styles.panel}>
          <h2>Prospect funnel</h2>
          <p className={styles.hint}>Never merged with ops chat.</p>
          <dl className={styles.stats}>
            <div><dt>Unique phones today</dt><dd>{pf?.uniquePhonesMessagedToday ?? 0}</dd></div>
            <div><dt>Inbound today</dt><dd>{pf?.inboundMessagesToday ?? 0}</dd></div>
            <div><dt>Leads today</dt><dd>{pf?.leadsCreatedToday ?? 0}</dd></div>
            <div><dt>AI cost (prospect)</dt><dd>${pf?.aiCostUsdToday ?? 0}</dd></div>
            <div><dt>Cost / lead</dt><dd>{data.costPerLeadUsd == null ? "—" : `$${data.costPerLeadUsd}`}</dd></div>
          </dl>
          <h3>Stages</h3>
          <ul className={styles.stages}>
            {["new", "contacted", "qualified", "reserved", "paid", "lost"].map((s) => (
              <li key={s}><span>{s}</span><strong>{stages[s] ?? 0}</strong></li>
            ))}
          </ul>
        </div>

        <div className={styles.panel}>
          <h2>Internal ops</h2>
          <p className={styles.hint}>Riley copilot — labeled separately.</p>
          <dl className={styles.stats}>
            <div><dt>Unique phones</dt><dd>{ops?.uniquePhonesMessagedToday ?? 0}</dd></div>
            <div><dt>Inbound today</dt><dd>{ops?.inboundMessagesToday ?? 0}</dd></div>
            <div><dt>AI cost (ops)</dt><dd>${ops?.aiCostUsdToday ?? 0}</dd></div>
            <div><dt>Phones</dt><dd>{(ops?.operatorPhones ?? []).join(", ")}</dd></div>
          </dl>
          <h3>Lead flow (unique prospect phones / day)</h3>
          <ul className={styles.flow}>
            {(data.leadFlowByDay ?? []).length === 0 && <li>No prospect traffic yet.</li>}
            {(data.leadFlowByDay ?? []).map((d) => (
              <li key={d.day}><span>{d.day}</span><strong>{d.uniquePhones}</strong></li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Posting queue</h2>
        <label className={styles.note}>
          Modification note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
        <div className={styles.queue}>
          {(data.postingQueue ?? []).map((idea) => (
            <article key={idea.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span>{idea.platform}</span>
                <span className={styles.badge}>{idea.status}</span>
              </div>
              <h3>{idea.hook}</h3>
              <pre>{idea.content.slice(0, 420)}</pre>
              {idea.error && <p className={styles.err}>{idea.error}</p>}
              {idea.zernioPlatformUrl && (
                <a href={idea.zernioPlatformUrl} target="_blank" rel="noreferrer">
                  Live post
                </a>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={() => act(idea.id, "approve")} disabled={pending}>
                  Approve
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => act(idea.id, "reject")} disabled={pending}>
                  Reject
                </button>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => act(idea.id, "request_modification")}
                  disabled={pending}
                >
                  Request mod
                </button>
              </div>
            </article>
          ))}
          {(data.postingQueue ?? []).length === 0 && <p>Queue empty.</p>}
        </div>
      </section>

      <section className={styles.grid2}>
        <div className={styles.panel}>
          <h2>Conversation reviews</h2>
          <ul className={styles.list}>
            {(data.recentReviews ?? []).map((r) => (
              <li key={r.id}>
                <strong>{r.severity}</strong> {r.phone ?? "—"}
                {r.missedOpportunity ? " · missed opp" : ""}
                <p>{r.findings}</p>
              </li>
            ))}
            {(data.recentReviews ?? []).length === 0 && <li>No reviews yet.</li>}
          </ul>
        </div>
        <div className={styles.panel}>
          <h2>Lead-gen drafts</h2>
          <ul className={styles.list}>
            {(data.leadGenDrafts ?? []).map((d) => (
              <li key={d.id}>
                <strong>{d.channel}</strong> · {d.status}
                <p>{d.hook}</p>
              </li>
            ))}
            {(data.leadGenDrafts ?? []).length === 0 && <li>No drafts yet.</li>}
          </ul>
        </div>
      </section>
    </main>
  );
}
