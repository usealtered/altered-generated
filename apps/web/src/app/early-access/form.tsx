"use client";

import { useState, useTransition } from "react";
import styles from "./form.module.css";

export function EarlyAccessForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
          process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
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
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something broke");
      }
    });
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <p className={styles.ok}>You&apos;re on the list. Deposit checkout will unlock once Stripe is connected.</p>
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
        {pending ? "Reserving…" : "Reserve — $250 deposit"}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  );
}
