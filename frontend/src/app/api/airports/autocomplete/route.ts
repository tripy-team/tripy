import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const limitParam = searchParams.get("limit") ?? "10";
  const limit = Number(limitParam);

  if (!q || q.length < 1) {
    return NextResponse.json({ airports: [] }, { status: 200 });
  }

  if (limit < 1 || limit > 20) {
    return NextResponse.json(
      { error: "limit must be between 1 and 20" },
      { status: 400 }
    );
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const url = `${backendUrl.replace(/\/$/, "")}/api/airports/autocomplete?q=${encodeURIComponent(q)}&limit=${limit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error(`Backend API error: ${response.status} ${response.statusText}`);
      // Return empty results on error rather than failing
      return NextResponse.json({ airports: [] }, { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Error fetching airports from backend:', error);
    // Return empty results on error rather than failing
    return NextResponse.json({ airports: [] }, { status: 200 });
  }
}
