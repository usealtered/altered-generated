const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "http://localhost:8787";

export async function createLead(input: {
  email?: string;
  name?: string;
  company?: string;
  notes?: string;
  wantDepositCheckout?: boolean;
}) {
  const res = await fetch(`${API_BASE}/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to create lead");
  }
  return res.json() as Promise<{
    id: string;
    status: string;
    checkoutUrl?: string;
  }>;
}
