import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const base = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!base) {
    return NextResponse.json({ error: "BACKEND_URL not set" }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Forward auth / anon-session headers from the client
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const anon = req.headers.get("x-anon-session-id");
  if (anon) headers["X-Anon-Session-Id"] = anon;

  let upstream: Response;
  try {
    const url = `${base.replace(/\/$/, "")}/solo/feedback`;
    upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Backend unreachable", detail: String(e) },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
