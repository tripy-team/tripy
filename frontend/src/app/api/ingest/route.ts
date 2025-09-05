// export async function POST(req: Request) {
//   const body = await req.text();
//   const upstream = await fetch(`${process.env.BACKEND_URL}/ingest`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body,
//   });
//   const text = await upstream.text();
//   return new Response(text, {
//     status: upstream.status,
//     headers: { "Content-Type": "application/json" },
//   });
// }

// app/api/ingest/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const base = process.env.BACKEND_URL;
  if (!base) {
    return NextResponse.json({ error: "BACKEND_URL not set" }, { status: 500 });
  }

  // parse JSON from browser
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Client sent non-JSON" }, { status: 400 });
  }

  // call FastAPI
  let upstream: Response;
  try {
    const url = `${base.replace(/\/$/, "")}/ingest`;
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Fetch to backend failed", detail: String(e) },
      { status: 502 },
    );
  }

  // always pipe through whatever FastAPI returned
  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
