import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Proxy the monitoring verification request to the backend.
 * The backend verifies the token and returns a redirect to the frontend booking page.
 * This route exists so the magic link in verification emails can point to a frontend URL.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/solo/booking?monitoring=invalid', request.url));
  }

  try {
    const backendUrl = `${BACKEND_URL}/solo/monitoring/verify?token=${encodeURIComponent(token)}`;
    const res = await fetch(backendUrl, { redirect: 'manual' });

    // Backend returns a 307 redirect — follow it
    const location = res.headers.get('location');
    if (location) {
      return NextResponse.redirect(new URL(location));
    }

    // Fallback: if no redirect, send to booking page with generic status
    return NextResponse.redirect(new URL('/solo/booking?monitoring=verified', request.url));
  } catch (error) {
    console.error('Verification proxy error:', error);
    return NextResponse.redirect(new URL('/solo/booking?monitoring=error', request.url));
  }
}
