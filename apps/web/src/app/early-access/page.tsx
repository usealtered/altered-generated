import styles from "./page.module.css";

const HERO_HEADLINE =
  "Ninety days from now, the feature you've been circling finally ships - because you stopped re-running the same procrastination loop you already solved.";

const HERO_SUBHEAD =
  "Koa is the always-on iMessage agent that holds context so detail-obsessed founders stop drifting and actually ship.";

/** Deep-link into Messages with Koa. Price stays in-thread after qualify. */
const IMESSAGE_HREF =
  "sms:+13054098546&body=Hey%20Koa%20-%20I%20want%20to%20talk%20about%20ALTERED.";

export const metadata = {
  title: "ALTERED",
  description: HERO_HEADLINE,
};

export default function EarlyAccessPage() {
  return (
    <main className={styles.page}>
      <div className={styles.grid} aria-hidden />
      <header className={styles.top}>
        <div className={styles.brand}>ALTERED</div>
        <div className={styles.meta}>FOUNDING COHORT</div>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>
          Always-on iMessage for detail-obsessed founders
        </p>
        <h1 className={styles.mark}>ALTERED</h1>
        <p className={styles.headline}>{HERO_HEADLINE}</p>
        <p className={styles.lede}>{HERO_SUBHEAD}</p>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href={IMESSAGE_HREF}>
            Text Koa
          </a>
          <span className={styles.hint}>Opens Messages · +1 (305) 409-8546</span>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>usealtered</span>
        <span>+13054098546</span>
      </footer>
    </main>
  );
}
