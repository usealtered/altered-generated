import { generatePostIdeas } from "./generate";
import {
  applyBatchApproval,
  buildApprovalLinks,
  getLatestPendingBatch,
  listPendingBatchIdeas,
  parseApprovalReply,
  tryHandleApprovalMessage,
  verifyBatchActionToken,
  type ApprovalAction,
} from "./approve";
import { publishApprovedPosts } from "./publish";
import { notifyOperatorOfBatch } from "./notify";
import {
  enqueueGenerate,
  enqueuePublish,
  ensurePostingSchedules,
  GENERATE_CRON,
  PUBLISH_CRON,
} from "./schedule";
import {
  postingEnabled,
  platformsForEnv,
  zernioConfigured,
  zernioListAccounts,
} from "./zernio";
import { applyIdeaAction, type IdeaModAction } from "./idea-actions";
import type { OperatorContext } from "../operator-context";

export {
  generatePostIdeas,
  applyBatchApproval,
  buildApprovalLinks,
  getLatestPendingBatch,
  listPendingBatchIdeas,
  parseApprovalReply,
  tryHandleApprovalMessage,
  verifyBatchActionToken,
  publishApprovedPosts,
  notifyOperatorOfBatch,
  enqueueGenerate,
  enqueuePublish,
  ensurePostingSchedules,
  GENERATE_CRON,
  PUBLISH_CRON,
  postingEnabled,
  platformsForEnv,
  zernioConfigured,
  zernioListAccounts,
  applyIdeaAction,
};
export type { ApprovalAction, IdeaModAction };

/**
 * Full generate tick: ensure schedules → generate batch → notify Riley.
 */
export async function runGenerateTick(
  ctx: OperatorContext,
  opts: { source?: string; count?: number } = {},
) {
  const schedules = await ensurePostingSchedules(ctx);
  const generated = await generatePostIdeas(ctx, {
    count: opts.count,
    source: opts.source ?? "cron",
  });
  if (!generated.ok || !generated.batchId) {
    return { schedules, generated, notified: null };
  }
  const notified = await notifyOperatorOfBatch(ctx, generated.batchId);
  return { schedules, generated, notified };
}

/**
 * Full publish tick: publish approved ideas via Zernio.
 */
export async function runPublishTick(
  ctx: OperatorContext,
  opts: { source?: string; limit?: number } = {},
) {
  await ensurePostingSchedules(ctx);
  return publishApprovedPosts(ctx, {
    source: opts.source ?? "cron",
    limit: opts.limit,
  });
}
