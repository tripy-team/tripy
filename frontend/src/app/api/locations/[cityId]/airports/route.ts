import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  context: { params: Promise<{ cityId: string }> | { cityId: string } }
) {
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit") ?? "3";
  const limit = Number(limitParam);
  
  // Handle both Promise and direct params (Next.js 15 compatibility)
  const resolvedParams = context.params instanceof Promise 
    ? await context.params 
    : context.params;
  const cityId = resolvedParams.cityId;

  if (!cityId) {
    return NextResponse.json({ airports: [] }, { status: 200 });
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const url = `${backendUrl.replace(/\/$/, "")}/api/locations/${encodeURIComponent(cityId)}/airports?limit=${limit}`;

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

