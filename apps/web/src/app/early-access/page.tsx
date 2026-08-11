import { EarlyAccessForm } from "./form";
import styles from "./page.module.css";

const HERO_HEADLINE =
  "Ninety days from now, the feature you've been circling finally ships - because you stopped re-running the same procrastination loop you already solved.";

const HERO_SUBHEAD =
  "Koa is the always-on iMessage agent that holds context so detail-obsessed founders stop drifting and actually ship.";

export const metadata = {
  title: "ALTERED — $100 founding reservation",
  description: `${HERO_HEADLINE} $100 reservation deposit credits toward the $499 ALTERED program.`,
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
        <p className={styles.kicker}>ALTERED · founding cohort</p>
        <h1 className={styles.mark}>ALTERED</h1>
        <p className={styles.headline}>{HERO_HEADLINE}</p>
        <p className={styles.lede}>{HERO_SUBHEAD}</p>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href="#reserve">
            Reserve with $100 deposit
          </a>
          <span className={styles.price}>
            Credits toward $499 (net $399) · limited seats
          </span>
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
          <h2>Claim your founding seat</h2>
          <p>
            $100 program reservation deposit credited to the $499 program (net
            $399). Six-month, AI-allowance based, part-service founder
            customization inside ALTERED. Text +13054098546 anytime.
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
