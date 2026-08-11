import type { Context } from "hono";
import { getServerEnv } from "@altered/env";

/**
 * Marketing HTML lives on the web project (generated.usealtered.com).
 * API /reserve and /early-access only redirect there - never serve landing HTML.
 */
export function siteEarlyAccessUrl(env = getServerEnv()): string {
  const base = (
    env.SITE_BASE_URL ?? "https://generated.usealtered.com"
  ).replace(/\/$/, "");
  return `${base}/early-access`;
}

export function reserveRedirectHandler(c: Context) {
  const env = getServerEnv();
  const target = new URL(siteEarlyAccessUrl(env));
  // Preserve UTM / query params from social posts
  const incoming = new URL(c.req.url);
  for (const [k, v] of incoming.searchParams) {
    target.searchParams.set(k, v);
  }
  return c.redirect(target.toString(), 302);
}
