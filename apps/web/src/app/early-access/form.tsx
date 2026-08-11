"use client";

import { useState, useTransition } from "react";
import styles from "./form.module.css";

const depositLabel = process.env.NEXT_PUBLIC_DEPOSIT_LABEL ?? "$100";

export function EarlyAccessForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ checkoutUrl?: string } | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          email: String(formData.get("email") ?? ""),
          name: String(formData.get("name") ?? "") || undefined,
          company: String(formData.get("company") ?? "") || undefined,
          notes: String(formData.get("notes") ?? "") || undefined,
          wantDepositCheckout: true,
          source: "web-early-access",
        };
        const api =
          process.env.NEXT_PUBLIC_API_BASE_URL ??
          "https://generated.api.usealtered.com";
        const res = await fetch(`${api}/leads`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as { checkoutUrl?: string };
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        setDone({ checkoutUrl: data.checkoutUrl });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something broke");
      }
    });
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <p className={styles.ok}>
          You&apos;re on the list. We&apos;ll send your reservation deposit link
          ({depositLabel}) shortly.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.wrap} action={onSubmit}>
      <label className={styles.field}>
        <span>Work email</span>
        <input name="email" type="email" required placeholder="you@company.com" />
      </label>
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" type="text" placeholder="Riley" />
      </label>
      <label className={styles.field}>
        <span>Company</span>
        <input name="company" type="text" placeholder="Acme" />
      </label>
      <label className={styles.field}>
        <span>What knowledge chaos are you drowning in?</span>
        <input name="notes" type="text" placeholder="Slack + Notion + tribal brain" />
      </label>
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Reserving…" : `Reserve — ${depositLabel}`}
      </button>
      <p className={styles.hint}>
        Credits toward the $499 program (net $399). Text +13054098546 anytime.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  );
}
