import { EarlyAccessForm } from "./form";
import styles from "./page.module.css";

export default async function EarlyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reserved?: string; canceled?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className={styles.page}>
      <div className={styles.grid} aria-hidden />
      <header className={styles.top}>
        <div className={styles.brand}>ALTERED</div>
        <div className={styles.meta}>EARLY ACCESS // COHORT 01</div>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>Knowledge Orchestration Infrastructure</p>
        <h1 className={styles.mark}>ALTERED</h1>
        <p className={styles.lede}>
          Reserve founding access. A deposit locks cohort pricing and puts you
          first in the orchestration stack.
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href="#reserve">
            Reserve with deposit
          </a>
          <span className={styles.price}>$99–$249 holds your seat</span>
        </div>
        {params.reserved ? (
          <p className={styles.flashOk}>Reservation received. We&apos;ll confirm by email.</p>
        ) : null}
        {params.canceled ? (
          <p className={styles.flashWarn}>Checkout canceled — seat still available.</p>
        ) : null}
      </section>

      <section className={styles.band} id="reserve">
        <div className={styles.bandCopy}>
          <h2>Claim early access</h2>
          <p>
            Built for teams drowning in fragmented knowledge. ALTERED turns docs,
            chats, and decisions into an operable system — not another search box.
          </p>
        </div>
        <EarlyAccessForm />
      </section>

      <footer className={styles.footer}>
        <span>usealtered</span>
        <span>human-in-the-loop agents</span>
      </footer>
    </main>
  );
}
