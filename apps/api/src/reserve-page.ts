import type { Context } from "hono";
import { getServerEnv } from "@altered/env";

/**
 * Interim money page served from the API until apps/web is deployed
 * to generated.usealtered.com (currently DEPLOYMENT_NOT_FOUND).
 */
export function renderReserveHtml(opts?: {
  checkoutUrl?: string | null;
  reserved?: boolean;
  canceled?: boolean;
}): string {
  const checkout = opts?.checkoutUrl?.trim() || "";
  const hasCheckout = Boolean(checkout);
  const flash = opts?.reserved
    ? `<p class="flash ok">Reservation received. We will confirm by email.</p>`
    : opts?.canceled
      ? `<p class="flash warn">Checkout canceled - seat still available.</p>`
      : "";

  const cta = hasCheckout
    ? `<a class="cta" href="${escapeHtml(checkout)}">Reserve with $100 deposit</a>`
    : `<a class="cta" href="#reserve">Reserve with $100 deposit</a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ALTERED — $100 program reservation</title>
  <meta name="description" content="Ninety days from now, the feature you've been circling finally ships. Koa is the always-on iMessage agent for detail-obsessed founders. $100 reservation deposit credits toward $499." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #07110f;
      --fog: #d7ebe3;
      --mist: #9bb8ad;
      --signal: #b6ff3c;
      --danger: #ff6b4a;
      --line: rgba(215, 235, 227, 0.14);
      --font-display: "Syne", sans-serif;
      --font-mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      color: var(--fog);
      font-family: var(--font-mono);
      background:
        radial-gradient(1100px 640px at 85% -10%, rgba(182,255,60,0.14), transparent 55%),
        radial-gradient(800px 480px at 8% 18%, rgba(56,140,110,0.24), transparent 50%),
        linear-gradient(165deg, #050c0a 0%, #0a1612 45%, #07110f 100%);
      background-attachment: fixed;
    }
    a { color: inherit; text-decoration: none; }
    .page { position: relative; min-height: 100vh; padding: 1.25rem clamp(1rem,4vw,3rem) 3rem; overflow: clip; }
    .grid {
      pointer-events: none; position: absolute; inset: 0;
      background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-size: 72px 72px;
      mask-image: radial-gradient(ellipse at 50% 20%, black 20%, transparent 75%);
      animation: pulse 7s ease-in-out infinite;
    }
    .top { position: relative; z-index: 1; display: flex; justify-content: space-between; gap: 1rem; animation: rise .7s ease both; }
    .brand { font-family: var(--font-display); font-weight: 800; letter-spacing: .08em; font-size: .95rem; }
    .meta { color: var(--mist); font-size: .72rem; letter-spacing: .14em; }
    .hero { position: relative; z-index: 1; min-height: calc(100svh - 5rem); display: flex; flex-direction: column; justify-content: flex-end; padding: 4rem 0 3rem; max-width: 42rem; }
    .kicker { margin: 0 0 .75rem; color: var(--signal); letter-spacing: .16em; text-transform: uppercase; font-size: .72rem; animation: rise .8s .05s ease both; }
    .mark { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: clamp(4.2rem, 16vw, 8.5rem); line-height: .88; letter-spacing: -.04em; text-transform: uppercase; animation: rise .9s .1s ease both; }
    .mark:after { content: ""; display: block; margin-top: .55rem; width: min(100%, 16rem); height: 3px; background: linear-gradient(90deg, var(--signal), transparent); }
    .headline { margin: 1.35rem 0 0; max-width: 38rem; font-family: var(--font-display); font-weight: 700; font-size: clamp(1.25rem, 3.2vw, 1.85rem); letter-spacing: -.02em; line-height: 1.25; animation: rise .9s .16s ease both; }
    .lede { margin: 1rem 0 0; max-width: 34rem; color: var(--mist); font-size: clamp(.95rem, 2.2vw, 1.08rem); line-height: 1.55; animation: rise .9s .2s ease both; }
    .row { margin-top: 2rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.25rem; animation: rise .9s .26s ease both; }
    .cta { display: inline-flex; align-items: center; justify-content: center; padding: .95rem 1.35rem; background: var(--signal); color: var(--ink); font-weight: 500; letter-spacing: .04em; text-transform: uppercase; font-size: .82rem; }
    .cta:hover { background: #c8ff66; }
    .price { color: var(--mist); font-size: .85rem; }
    .flash { margin-top: 1.25rem; max-width: 32rem; padding: .75rem 0; border-top: 1px solid var(--line); font-size: .85rem; }
    .flash.ok { color: var(--signal); }
    .flash.warn { color: var(--danger); }
    .band { position: relative; z-index: 1; margin-top: 1rem; padding: 3rem 0 1rem; border-top: 1px solid var(--line); display: grid; gap: 2rem; max-width: 42rem; }
    .band h2 { margin: 0 0 .75rem; font-family: var(--font-display); font-size: clamp(1.6rem, 3.5vw, 2.2rem); letter-spacing: -.03em; }
    .band p, .band li { color: var(--mist); line-height: 1.6; }
    .band ul { margin: 0; padding-left: 1.1rem; }
    form { display: grid; gap: .85rem; }
    label { display: grid; gap: .35rem; }
    label span { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--mist); }
    input { width: 100%; border: 1px solid var(--line); background: rgba(7,17,15,.65); color: var(--fog); padding: .85rem .9rem; font: inherit; outline: none; }
    input:focus { border-color: rgba(182,255,60,.55); box-shadow: 0 0 0 3px rgba(182,255,60,.18); }
    button { border: 0; cursor: pointer; padding: .95rem 1.1rem; background: var(--signal); color: var(--ink); text-transform: uppercase; letter-spacing: .06em; font: inherit; font-size: .8rem; font-weight: 500; }
    button:disabled { opacity: .65; }
    .err { color: var(--danger); font-size: .8rem; margin: 0; }
    .okmsg { color: var(--signal); margin: 0; line-height: 1.5; }
    .footer { position: relative; z-index: 1; margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 1rem; color: var(--mist); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: .9; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="grid" aria-hidden="true"></div>
    <header class="top">
      <div class="brand">ALTERED</div>
      <div class="meta">FOUNDING COHORT // $100</div>
    </header>
    <section class="hero">
      <p class="kicker">ALTERED · founding cohort</p>
      <h1 class="mark">ALTERED</h1>
      <p class="headline">Ninety days from now, the feature you've been circling finally ships - because you stopped re-running the same procrastination loop you already solved.</p>
      <p class="lede">Koa is the always-on iMessage agent that holds context so detail-obsessed founders stop drifting and actually ship.</p>
      <div class="row">
        ${cta}
        <span class="price">$100 reservation deposit · credits toward $499 (net $399)</span>
      </div>
      ${flash}
    </section>
    <section class="band" id="reserve">
      <div>
        <h2>What you get</h2>
        <ul>
          <li>$100 reservation deposit credited to the $499 program</li>
          <li>6-month, AI-allowance based, part-service founder customization</li>
          <li>Priority founding-cohort access while Layer 1 hardens</li>
          <li>Honest pre-launch framing - no fake testimonials</li>
        </ul>
      </div>
      <div>
        <h2>Reserve</h2>
        <p>Leave your email. If checkout is live you go straight to the $100 deposit. Text +13054098546 anytime.</p>
        <form id="f">
          <label><span>Work email</span><input name="email" type="email" required placeholder="you@company.com" /></label>
          <label><span>Name</span><input name="name" type="text" placeholder="Alex" /></label>
          <label><span>What are you building?</span><input name="notes" type="text" placeholder="The product you keep re-scoping" /></label>
          <button type="submit">Reserve - $100</button>
          <p class="err" id="err" hidden></p>
          <p class="okmsg" id="ok" hidden></p>
        </form>
      </div>
    </section>
    <footer class="footer">
      <span>usealtered</span>
      <span>text +13054098546</span>
    </footer>
  </main>
  <script>
    const hasCheckout = ${hasCheckout ? "true" : "false"};
    const checkoutUrl = ${JSON.stringify(checkout)};
    const api = location.origin;
    const utm = (() => {
      const p = new URLSearchParams(location.search);
      const out = {};
      for (const k of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"]) {
        const v = p.get(k);
        if (v) out[k] = v;
      }
      return out;
    })();
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("err");
      const ok = document.getElementById("ok");
      err.hidden = true; ok.hidden = true;
      const fd = new FormData(e.target);
      const payload = {
        email: String(fd.get("email") || ""),
        name: String(fd.get("name") || "") || undefined,
        notes: String(fd.get("notes") || "") || undefined,
        wantDepositCheckout: true,
        source: utm.utm_source ? ("social:" + utm.utm_source) : "web-reserve",
        utm: Object.keys(utm).length ? utm : undefined,
      };
      try {
        const res = await fetch(api + "/leads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const url = data.checkoutUrl || checkoutUrl;
        if (url) { location.href = url; return; }
        ok.textContent = "You're on the founding list. We will send the $100 reservation link shortly.";
        ok.hidden = false;
      } catch (ex) {
        err.textContent = ex && ex.message ? ex.message : "Something broke";
        err.hidden = false;
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function reservePageHandler(c: Context) {
  const env = getServerEnv();
  const reserved = c.req.query("reserved") === "1";
  const canceled = c.req.query("canceled") === "1";
  const html = renderReserveHtml({
    checkoutUrl: env.PRIMARY_CHECKOUT_URL,
    reserved,
    canceled,
  });
  return c.html(html);
}
