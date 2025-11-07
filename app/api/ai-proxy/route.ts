import { NextRequest, NextResponse } from "next/server";

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Get AI API URL from environment variable or use default
    // Priority: AI_API_URL > n8n (container name, same network) > host.docker.internal > localhost
    const defaultHost = process.env.NODE_ENV === 'production' 
      ? (process.env.DOCKER_HOST_IP || '172.17.0.1') // Default Docker bridge gateway for Linux
      : 'localhost';
    let aiApiUrl = process.env.AI_API_URL || `http://${process.env.NODE_ENV === 'production' ? 'n8n' : defaultHost}:5678/webhook/40094c38-c178-4cfa-ba50-a92d937c50da`;
    
    console.log("🤖 Calling AI API:", aiApiUrl);
    console.log("📤 Request body:", body);
    
    let response;
    try {
      response = await fetch(aiApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000) // 30 seconds timeout
    });
    } catch (fetchError: any) {
      // If container name doesn't work, try fallback URLs
      if (process.env.NODE_ENV === 'production' && 
          (fetchError.message?.includes("ENOTFOUND") || 
           fetchError.message?.includes("getaddrinfo") ||
           fetchError.cause?.code === "ENOTFOUND")) {
        console.warn("⚠️ Container name 'n8n' not found, trying fallback URLs...");
        
        // Try fallback URLs
        const fallbackUrls = [
          `http://host.docker.internal:5678/webhook/40094c38-c178-4cfa-ba50-a92d937c50da`,
          `http://localhost:5678/webhook/40094c38-c178-4cfa-ba50-a92d937c50da`
        ];
        
        for (const fallbackUrl of fallbackUrls) {
          try {
            console.log("🔄 Trying fallback URL:", fallbackUrl);
            response = await fetch(fallbackUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(10000), // 10 seconds timeout for fallback
            });
            if (response.ok) {
              console.log("✅ Fallback URL succeeded:", fallbackUrl);
              break;
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

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error("❌ AI API error:", response.status, errorText);
      
      // Handle 404 specifically
      if (response.status === 404) {
        return NextResponse.json(
          { 
            error: "ไม่พบ AI service. กรุณาตรวจสอบว่า AI service กำลังทำงานอยู่ที่ port 5678",
            details: `URL: ${aiApiUrl}`,
            code: "NOT_FOUND"
          },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { 
          error: `AI API error: ${response.status}`,
          details: errorText,
          code: "API_ERROR"
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("✅ AI API response received");
    
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error("❌ Error proxying AI request:", error);
    
    // Handle timeout
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return NextResponse.json(
        { 
          error: "Request timeout. AI service ใช้เวลาตอบสนองนานเกินไป",
          code: "TIMEOUT"
        },
        { status: 504 }
      );
    }
    
    // Handle network errors (connection refused, etc.)
    if (error.message?.includes("fetch failed") || 
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("Failed to fetch") ||
        error.cause?.code === "ECONNREFUSED") {
      return NextResponse.json(
        { 
          error: "ไม่สามารถเชื่อมต่อกับ AI service ได้. กรุณาตรวจสอบว่า AI service กำลังทำงานอยู่ที่ port 5678",
          details: error.message,
          code: "CONNECTION_ERROR"
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { 
        error: "เกิดข้อผิดพลาดในการเรียก AI API",
        details: error.message || "Unknown error",
        code: "SERVER_ERROR"
      },
      { status: 500 }
    );
  }
}

