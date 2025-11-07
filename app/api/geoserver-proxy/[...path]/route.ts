import { NextRequest, NextResponse } from "next/server";

// Force dynamic rendering for this route (uses searchParams)
export const dynamic = 'force-dynamic';

// GeoServer Proxy - Forward GET requests to GeoServer (for WMS, WFS GET requests)
// This catch-all route handles paths like: /api/geoserver-proxy/geoserver/it.geosolutions/wms
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    console.log("📥 GeoServer Proxy Request received");
    console.log("📥 Request URL:", request.nextUrl.href);
    console.log("📥 Params:", JSON.stringify(params, null, 2));
    
    const { searchParams } = request.nextUrl;
    
    // Get GeoServer URL from environment variable or use default
    // Priority: GEOSERVER_URL > geoserver (container name, same network) > host.docker.internal (same host) > localhost
    let geoserverUrl = process.env.GEOSERVER_URL;
    
    if (!geoserverUrl) {
      // In development (npm run dev), use localhost since we're not in Docker
      // In production (Docker), try container name first
      if (process.env.NODE_ENV === 'production') {
        geoserverUrl = "http://geoserver:8080";
      } else {
        // Development: use localhost since we're running outside Docker
        geoserverUrl = "http://localhost:8080";
      }
    } else {
      // Normalize URL: if URL ends with : or doesn't have port, add :8080
      geoserverUrl = geoserverUrl.trim();
      if (geoserverUrl.endsWith(':')) {
        geoserverUrl = geoserverUrl + '8080';
      } else if (!geoserverUrl.match(/:\d+(\/|$)/)) {
        // No port specified, add default port 8080
        geoserverUrl = geoserverUrl.replace(/\/$/, '') + ':8080';
      }
    }
    
    // In Next.js 14, params is an object directly (not a Promise)
    // Extract path segments from catch-all route
    const pathSegments = params?.path || [];
    
    // Validate path segments
    if (!pathSegments || pathSegments.length === 0) {
      console.error("❌ No path segments found in params:", JSON.stringify(params, null, 2));
      return NextResponse.json(
        { 
          error: "Invalid path: no segments found", 
          params: params,
          requestPath: request.nextUrl.pathname
        },
        { status: 400 }
      );
    }
    
    console.log("✅ Path segments extracted:", pathSegments);
    
    // Build the full URL with query parameters
    // Reconstruct the path from catch-all segments
    // pathSegments is an array like: ['geoserver', 'it.geosolutions', 'wms']
    const pathAfterProxy = '/' + pathSegments.join('/');
    
    // Get query string from URL searchParams (already parsed by Next.js)
    const queryString = searchParams.toString();
    
    // Build URL - only add ? if there are query parameters
    const fullUrl = queryString 
      ? `${geoserverUrl}${pathAfterProxy}?${queryString}`
      : `${geoserverUrl}${pathAfterProxy}`;
    
    console.log("📤 GeoServer Proxy GET Request:", fullUrl);
    console.log("📤 Path segments:", pathSegments);
    
    // Determine timeout based on request type
    // GetFeatureInfo requests need longer timeout (especially on server with network latency)
    const isGetFeatureInfo = searchParams.get('request') === 'GetFeatureInfo';
    const isGetMap = searchParams.get('request') === 'GetMap';
    const timeout = isGetFeatureInfo ? 30000 : (isGetMap ? 20000 : 10000); // 30s for GetFeatureInfo, 20s for GetMap, 10s for others
    
    let response;
    try {
      response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "Accept": request.headers.get("accept") || "*/*",
          "Connection": "keep-alive",
        },
        signal: AbortSignal.timeout(timeout),
        keepalive: true, // Enable connection reuse
      });
    } catch (fetchError: any) {
      console.error("❌ Initial fetch failed:", fetchError.message);
      console.error("❌ Error details:", {
        name: fetchError.name,
        cause: fetchError.cause,
        message: fetchError.message
      });
      
      // If container name doesn't work, try fallback URLs
      const isNetworkError = fetchError.message?.includes("ENOTFOUND") || 
                            fetchError.message?.includes("getaddrinfo") ||
                            fetchError.message?.includes("fetch failed") ||
                            fetchError.cause?.code === "ENOTFOUND" ||
                            fetchError.cause?.code === "ECONNREFUSED";
      
      if (isNetworkError) {
        console.warn("⚠️ Network error detected, trying fallback URLs...");
        
        // Try fallback URLs (always try localhost in development, or if container name fails)
        const fallbackUrls = [
          `http://localhost:8080${pathAfterProxy}${queryString ? '?' + queryString : ''}`,
          `http://host.docker.internal:8080${pathAfterProxy}${queryString ? '?' + queryString : ''}`
        ];
        
        for (const fallbackUrl of fallbackUrls) {
          try {
            console.log("🔄 Trying fallback URL:", fallbackUrl);
            response = await fetch(fallbackUrl, {
              method: "GET",
              headers: {
                "Accept": request.headers.get("accept") || "*/*",
              },
              signal: AbortSignal.timeout(timeout), // Use same timeout as initial request
            });
            if (response.ok) {
              console.log("✅ Fallback URL succeeded:", fallbackUrl);
              break;
            } else {
              console.warn("⚠️ Fallback URL returned non-OK status:", response.status);
            }
          } catch (e: any) {
            console.warn("❌ Fallback URL failed:", fallbackUrl, e?.message || String(e));
            continue;
          }
        }
        
        if (!response || !response.ok) {
          throw fetchError; // Re-throw original error if all fallbacks fail
        }
      } else {
        throw fetchError;
      }
    }

    // Get content type - for GetMap requests, it should be image/png
    let contentType = response.headers.get("content-type");
    if (!contentType) {
      // If no content-type header, try to detect from request
      if (isGetMap) {
        contentType = "image/png";
      } else {
        contentType = "application/json";
      }
    }
    
    const data = await response.arrayBuffer();
    
    console.log("📥 GeoServer Response Status:", response.status, response.statusText);
    console.log("📥 Content-Type:", contentType);
    console.log("📥 Data size:", data.byteLength, "bytes");
    
    if (!response.ok) {
      const errorText = new TextDecoder().decode(data);
      console.error("❌ GeoServer Error:", errorText.substring(0, 500));
      
      return new NextResponse(errorText, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    
    // For GetMap requests, verify it's actually an image
    if (isGetMap && data.byteLength === 0) {
      console.error("❌ GetMap response is empty");
      return new NextResponse("Empty image response from GeoServer", {
        status: 500,
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    
    // For GetMap requests (images), add proper cache headers
    const cacheControl = isGetMap 
      ? "public, max-age=86400, stale-while-revalidate=604800, immutable"
      : "public, max-age=3600";
    
    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": cacheControl,
      },
    });
  } catch (err: any) {
    console.error("❌ GeoServer Proxy Error:", err);
    
    let errorMessage = err.message || "Unknown error";
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      errorMessage = "Request timeout: GeoServer did not respond in time";
    } else if (err.message?.includes("ECONNREFUSED") || err.message?.includes("connect")) {
      errorMessage = "Connection refused: Cannot connect to GeoServer";
    } else if (err.message?.includes("ENOTFOUND")) {
      errorMessage = "Host not found: Cannot resolve GeoServer hostname";
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        type: err.name || "Error"
      }, 
      { 
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

