import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitParam = searchParams.get("limit") ?? "10";
  const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 20);
  const gl = searchParams.get("gl") ?? "us";
  const hl = searchParams.get("hl") ?? "en";
  const fuzzyFallback = searchParams.get("fuzzy_fallback") !== "false";
  const commercialOnly = searchParams.get("commercial_only") === "true";

  if (!q || q.length < 1) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
  const url = `${backendUrl.replace(/\/$/, "")}/api/destinations/autocomplete?q=${encodeURIComponent(q)}&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}&fuzzy_fallback=${fuzzyFallback}&commercial_only=${commercialOnly}&limit=${limit}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Backend destinations/autocomplete error: ${response.status} ${response.statusText}`);
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error fetching destinations autocomplete from backend:", error);
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }
}
