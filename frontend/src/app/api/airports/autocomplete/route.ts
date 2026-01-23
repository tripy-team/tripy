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
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`Backend API error: ${response.status} ${response.statusText}`, errorText);
      // Return error details for debugging
      return NextResponse.json(
        { 
          airports: [], 
          error: `Backend error: ${response.status} ${response.statusText}`,
          backendUrl: url 
        }, 
        { status: 200 }
      );
    }

    const data = await response.json();
    
    // Log if we get empty results for debugging
    if (!data.airports || data.airports.length === 0) {
      console.warn(`Backend returned empty airports array for query: "${q}"`);
    }
    
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching airports from backend:', errorMessage, 'URL:', url);
    // Return error details for debugging
    return NextResponse.json(
      { 
        airports: [], 
        error: `Network error: ${errorMessage}`,
        backendUrl: url 
      }, 
      { status: 200 }
    );
  }
}
