---
title: Memory, metrics, and scale roadmap
---

# Memory + metrics (source of truth)

Last updated: 2026-08-10.

## What ships now (pre-test)

### Durable memory = keyed facts (not vectors)
- Table: `memories` (Neon). Keys are **human slugs** (`offer.deposit`, `prefs.git.main-first`), not nanoids.
- Row `id` is UUID. `save_memory` **requires** a key (upsert).
- Always-on preamble: soft-default agent + ≤3 open `dev_tasks` + ≤6 keyed facts.
- Chat history: last ~6 Redis turns. Narrative recall via `recall_memories` / `search_knowledge` only when needed.
- Redis mirrors keyed facts (`memory:key:*`) and a capped list. Not an MRU eviction of Postgres — DB grows; ranking is by `updated_at`.

### Observability
- `ai_events`: append-only per LLM turn (surface, model, tokens, estimated `cost_micros`, latency, tools, ok/error).
- `daily_metrics` rollups: `ai_calls`, `ai_input_tokens`, `ai_output_tokens`, `ai_cost_micros` (+ leads/deposits/imessage/cursor).
- `get_metrics` exposes AI spend + rough `$ AI / lead`.

### Sales funnel spine
- `leads.status` is the stage (`new|contacted|qualified|reserved|paid|lost`).
- `lead_events`: append-only created/updated/status_changed for analytics.
- `save_lead` upserts by email/phone and writes a `lead_events` row.

### Knowledge RAG
- Still lexical over `knowledge/` markdown (in-process cache). No pgvector/Pinecone on the hot path.

## Post-test roadmap (do not lose)

Ordered by Hormozi leverage: **measure cash → tighten context → smarter recall**.

1. **Invoice-accurate costs** — reconcile OpenRouter usage/pricing into `ai_events` (replace estimate table).
2. **Scoreboard** — daily: leads → qualified → checkout sent → deposits → cash; `$ / lead`, `$ AI / deposit`, tool failure rates.
3. **Postgres FTS / ILIKE** on `memories` (scoped) before any vector DB — fix relevance of “last N + JS includes”.
4. **Sales surface** — separate allowlisted prospect flow from Riley ops; per-lead memory scope; never pollute global ops facts.
5. **Vectors only if measured need** — when note volume / miss rate / token$ justify pgvector or Pinecone for fuzzy notes. Facts stay keyed SQL.
6. **Approach experiments** — tag `ai_events.meta.approach` (script/model/preamble variant) to kill losers with data.

## Explicit non-goals (for now)
- Pinecone/pgvector as default memory
- Stuffing full knowledge corpus into every turn
- Giant memory abstraction before real conversation + cost rows exist
