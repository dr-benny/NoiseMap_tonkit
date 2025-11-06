import { NextRequest, NextResponse } from "next/server";

// WFS Proxy - Forward requests to GeoServer
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    
    console.log("📤 WFS Proxy Request to GeoServer");
    console.log("📤 Request body length:", body.length, "characters");
    console.log("📤 Request body preview:", body.substring(0, 500));
    
    // Forward to actual GeoServer
    // Use container name 'geoserver' when running in Docker, 'localhost' for local dev
    const defaultGeoserverUrl = process.env.NODE_ENV === 'production' 
      ? "http://geoserver:8080/geoserver/it.geosolutions/wfs"
      : "http://localhost:8080/geoserver/it.geosolutions/wfs";
    const geoserverUrl = process.env.GEOSERVER_URL || defaultGeoserverUrl;
    const geoserverUser = process.env.GEOSERVER_USER || "admin";
    const geoserverPassword = process.env.GEOSERVER_PASSWORD || "geoserver";
    
    console.log("📤 Connecting to GeoServer:", geoserverUrl);
    
    const response = await fetch(geoserverUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "text/xml",
        "Authorization": `Basic ${Buffer.from(`${geoserverUser}:${geoserverPassword}`).toString('base64')}`
      },
      body: body,
      // Add timeout
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

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
    
    // Handle specific error types
    let errorMessage = err.message || "Unknown error";
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      errorMessage = "Request timeout: GeoServer did not respond in time";
    } else if (err.message?.includes("ECONNREFUSED") || err.message?.includes("connect")) {
      errorMessage = "Connection refused: Cannot connect to GeoServer. Please check if GeoServer is running.";
    } else if (err.message?.includes("ENOTFOUND")) {
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
