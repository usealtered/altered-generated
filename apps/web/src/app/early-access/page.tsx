import { EarlyAccessForm } from "./form";
import styles from "./page.module.css";

export const metadata = {
  title: "ALTERED — $100 founding reservation",
  description:
    "Never lose your best thinking again. $100 reservation deposit credits toward the $499 ALTERED program.",
};

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
        <div className={styles.meta}>FOUNDING COHORT // $100</div>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>
          Always-on iMessage for detail-obsessed founders
        </p>
        <h1 className={styles.mark}>ALTERED</h1>
        <p className={styles.headline}>Never lose your best thinking again.</p>
        <p className={styles.lede}>
          Pressure pivots and redundant thinking kill shipping. ALTERED remembers
          what you decided and keeps you locked on the goal until it ships.
          Reserve a founding seat with a $100 deposit - credits toward the $499
          program (net $399).
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href="#reserve">
            Reserve your seat - $100
          </a>
          <span className={styles.price}>Limited founding-cohort seats</span>
        </div>
        {params.reserved ? (
          <p className={styles.flashOk}>
            Reservation received. We&apos;ll confirm by email.
          </p>
        ) : null}
        {params.canceled ? (
          <p className={styles.flashWarn}>
            Checkout canceled - seat still available.
          </p>
        ) : null}
      </section>

      <section className={styles.band} id="reserve">
        <div className={styles.bandCopy}>
          <h2>What you get</h2>
          <p>
            $100 reservation deposit credited to the $499 program. Six-month,
            AI-allowance based, part-service founder customization inside ALTERED.
            Honest founding-cohort framing - no fake testimonials. Text
            +13054098546 anytime.
          </p>
        </div>
        <EarlyAccessForm />
      </section>

      <footer className={styles.footer}>
        <span>usealtered</span>
        <span>text +1 (305) 409-8546</span>
      </footer>
    </main>
  );
}
