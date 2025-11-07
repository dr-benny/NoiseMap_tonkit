import { NextRequest, NextResponse } from "next/server";

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// WFS Proxy - Forward requests to GeoServer
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    
    console.log("📤 WFS Proxy Request to GeoServer");
    console.log("📤 Request body length:", body.length, "characters");
    console.log("📤 Request body preview:", body.substring(0, 500));
    
    // Forward to actual GeoServer
    // Priority: GEOSERVER_URL > geoserver (container name, same network) > host.docker.internal (same host) > localhost
    let geoserverUrl = process.env.GEOSERVER_URL;
    
    if (!geoserverUrl) {
      // In development (npm run dev), use localhost since we're not in Docker
      // In production (Docker), try container name first
      if (process.env.NODE_ENV === 'production') {
        geoserverUrl = "http://geoserver:8080/geoserver/wfs";
      } else {
        // Development: use localhost since we're running outside Docker
        geoserverUrl = "http://localhost:8080/geoserver/wfs";
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
      
      // If GEOSERVER_URL is set but doesn't include /geoserver/wfs, add it
      if (!geoserverUrl.includes('/geoserver/wfs')) {
        geoserverUrl = geoserverUrl.replace(/\/$/, '') + '/geoserver/wfs';
      }
    }
    const geoserverUser = process.env.GEOSERVER_USER || "admin";
    const geoserverPassword = process.env.GEOSERVER_PASSWORD || "geoserver";
    
    console.log("📤 Connecting to GeoServer:", geoserverUrl);
    
    let response;
    try {
      response = await fetch(geoserverUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "text/xml",
          "Authorization": `Basic ${Buffer.from(`${geoserverUser}:${geoserverPassword}`).toString('base64')}`
        },
        body: body,
        // Add timeout
        signal: AbortSignal.timeout(15000), // 15 seconds timeout (reduced for better UX)
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
      
      if (isNetworkError && process.env.NODE_ENV === 'production' && geoserverUrl?.includes('geoserver:8080')) {
        console.warn("⚠️ Container name 'geoserver' not found, trying fallback URLs...");
        const fallbackUrls = [
          "http://host.docker.internal:8080/geoserver/wfs",
          "http://localhost:8080/geoserver/wfs"
        ];
        
        for (const fallbackUrl of fallbackUrls) {
          try {
            console.log("🔄 Trying fallback URL:", fallbackUrl);
            response = await fetch(fallbackUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "text/xml",
                "Authorization": `Basic ${Buffer.from(`${geoserverUser}:${geoserverPassword}`).toString('base64')}`
              },
              body: body,
              signal: AbortSignal.timeout(10000),
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

    const text = await response.text();
    
    // Log response for debugging
    console.log("📥 GeoServer Response Status:", response.status, response.statusText);
    console.log("📥 Response length:", text.length, "characters");
    
    // If error response, log it
    if (!response.ok) {
      console.error("❌ GeoServer Error Response:");
      console.error("  Status:", response.status, response.statusText);
      console.error("  Response preview:", text.substring(0, 1000));
      
      // Try to parse error message
      let errorMessage = `GeoServer returned ${response.status}: ${response.statusText}`;
      if (text) {
        // Try to extract error message from XML or JSON
        try {
          if (text.includes('<ows:ExceptionText>')) {
            const match = text.match(/<ows:ExceptionText>(.*?)<\/ows:ExceptionText>/);
            if (match) errorMessage = match[1];
          } else if (text.trim().startsWith('{')) {
            const json = JSON.parse(text);
            errorMessage = json.error || json.message || errorMessage;
          }
        } catch (e) {
          // Keep default error message
        }
      }
      
      return new NextResponse(
        JSON.stringify({ 
          error: errorMessage,
          status: response.status,
          details: text.substring(0, 500)
        }), 
        { 
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    
    // Check if response is JSON or XML based on content
    const contentType = text.trim().startsWith('{') 
      ? "application/json" 
      : response.headers.get("content-type") || "application/xml";
    
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("❌ WFS Proxy Error:", err);
    console.error("❌ Error details:", {
      name: err.name,
      cause: err.cause,
      message: err.message
    });
    
    // Handle specific error types
    let errorMessage = err.message || "Unknown error";
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      errorMessage = "Request timeout: GeoServer did not respond in time";
    } else if (err.message?.includes("ECONNREFUSED") || err.message?.includes("connect")) {
      errorMessage = "Connection refused: Cannot connect to GeoServer. Please check if GeoServer is running.";
    } else if (err.message?.includes("ENOTFOUND") || err.message?.includes("fetch failed")) {
      errorMessage = "Host not found: Cannot resolve GeoServer hostname.";
    }
    
    return new NextResponse(
      JSON.stringify({ 
        error: errorMessage,
        type: err.name || "Error"
      }), 
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
