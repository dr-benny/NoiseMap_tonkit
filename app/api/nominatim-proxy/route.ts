import { NextRequest, NextResponse } from "next/server";

// Force dynamic rendering for this route (uses searchParams)
export const dynamic = 'force-dynamic';

// Nominatim Proxy - Forward requests to Nominatim API to avoid CORS issues
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    
    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 }
      );
    }
    
    // Build Nominatim API URL
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(query)}` +
      `&format=json` +
      `&limit=10` +
      `&addressdetails=1` +
      `&namedetails=1` +
      `&countrycodes=TH` +
      `&accept-language=th,en` +
      `&dedupe=1`;
    
    // Forward request to Nominatim API with proper headers
    // Nominatim requires proper User-Agent and may have rate limiting
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'th,en',
        'Referer': request.headers.get('referer') || 'http://localhost:3000',
        'Accept': 'application/json',
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000) // 10 seconds timeout
    });
    
    // Handle 403 (rate limit) or other errors gracefully
    if (response.status === 403) {
      console.warn("⚠️ Nominatim API rate limit or blocked (403)");
      return NextResponse.json(
        { error: 'Service temporarily unavailable. Please try again later.', code: 'RATE_LIMIT' },
        { 
          status: 429, // Too Many Requests
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '60', // Suggest retry after 60 seconds
          },
        }
      );
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ Nominatim API error ${response.status}:`, errorText.substring(0, 200));
      throw new Error(`Nominatim API failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    return NextResponse.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    // Handle timeout or network errors
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      console.error("❌ Nominatim Proxy Timeout");
      return NextResponse.json(
        { error: 'Request timeout. Please try again.', code: 'TIMEOUT' },
        { 
          status: 504,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
    
    console.error("❌ Nominatim Proxy Error:", err);
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

