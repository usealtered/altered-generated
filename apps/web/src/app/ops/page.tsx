import { cookies } from "next/headers";
import { OpsDashboardClient } from "./ui";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "https://generated.api.usealtered.com";

export const metadata = {
  title: "ALTERED Ops",
  description: "Internal ops dashboard",
  robots: { index: false, follow: false },
};

async function fetchDashboard(key: string) {
  const res = await fetch(
    `${API_BASE.replace(/\/$/, "")}/ops/dashboard?key=${encodeURIComponent(key)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    return { ok: false as const, status: res.status, error: await res.text() };
  }
  return (await res.json()) as Record<string, unknown> & { ok: boolean };
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const key = sp.key ?? cookieStore.get("altered_ops_key")?.value ?? "";

  if (!key) {
    return (
      <main style={{ fontFamily: "ui-sans-serif", padding: "2rem", maxWidth: 640 }}>
        <h1>ALTERED Ops</h1>
        <p>Gated. Open with <code>?key=YOUR_OPS_DASHBOARD_SECRET</code>.</p>
      </main>
    );
  }

  const data = await fetchDashboard(key);
  if (!data.ok) {
    return (
      <main style={{ fontFamily: "ui-sans-serif", padding: "2rem" }}>
        <h1>Unauthorized or API error</h1>
        <pre>{String((data as { error?: string }).error ?? data.status)}</pre>
      </main>
    );
  }

  // Persist key in cookie for subsequent navigations without putting secret in every link body
  // (client will set via form). Soft redirect if only in query.
  if (sp.key) {
    // Continue render; client sets cookie.
  }

  return (
    <OpsDashboardClient
      apiBase={API_BASE.replace(/\/$/, "")}
      secret={key}
      initial={data}
    />
  );
}
