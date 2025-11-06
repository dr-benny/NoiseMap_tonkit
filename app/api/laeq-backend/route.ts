import { NextRequest, NextResponse } from "next/server";

interface LAeqBackendRequest {
  date: string; // YYYY-MM-DD
  lat: number;
  lng: number;
  type: 'L24h' | 'Lday' | 'Levening' | 'Lnight' | 'L1h';
}

// Mock data generator
function generateMockLAeq(type: string, date: string): {
  laeq: number;
  totalRecords: number;
  min: number;
  max: number;
  avg: number;
  trendData: Array<{ hour: number; laeq: number; count: number }>;
} {
  // Base LAeq values based on type
  let baseLAeq = 65;
  if (type === 'Lday') baseLAeq = 70;
  else if (type === 'Levening') baseLAeq = 68;
  else if (type === 'Lnight') baseLAeq = 55;
  else if (type === 'L1h') baseLAeq = 67;

  // Generate hourly trend data for L24h
  const trendData: Array<{ hour: number; laeq: number; count: number }> = [];
  
  if (type === 'L24h') {
    for (let h = 0; h < 24; h++) {
      // Simulate noise pattern: higher during day, lower at night
      let hourlyLAeq = baseLAeq;
      if (h >= 6 && h < 18) {
        // Daytime: 65-75 dB
        hourlyLAeq = 65 + Math.random() * 10;
      } else if (h >= 18 && h < 22) {
        // Evening: 60-70 dB
        hourlyLAeq = 60 + Math.random() * 10;
      } else {
        // Night: 50-60 dB
        hourlyLAeq = 50 + Math.random() * 10;
      }
      
      trendData.push({
        hour: h,
        laeq: parseFloat(hourlyLAeq.toFixed(1)),
        count: 60, // 60 records per hour
      });
    }
  }

  // Calculate stats
  const min = baseLAeq - 15 + Math.random() * 5;
  const max = baseLAeq + 10 + Math.random() * 5;
  const avg = baseLAeq + Math.random() * 2 - 1;
  const totalRecords = type === 'L1h' ? 60 : type === 'L24h' ? 1440 : type === 'Lday' ? 720 : type === 'Levening' ? 240 : 600;

  return {
    laeq: parseFloat((baseLAeq + Math.random() * 2 - 1).toFixed(1)),
    totalRecords,
    min: parseFloat(min.toFixed(1)),
    max: parseFloat(max.toFixed(1)),
    avg: parseFloat(avg.toFixed(1)),
    trendData,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: LAeqBackendRequest = await request.json();
    const { date, lat, lng, type } = body;

    console.log("📊 Mock LAeq Backend Request:", { date, lat, lng, type });

    // Return mock data for now
    const mockData = generateMockLAeq(type, date);

    return NextResponse.json({
      ...mockData,
      type,
      date,
    });

    /* 
    // TODO: Replace with actual implementation
    // เรียกใช้ PostgreSQL Function หรือ GeoServer
    
    const startTime = `${date}T00:00:00`;
    const endTime = `${date}T23:59:59`;
    
    let hourFilter = '';
    if (type === 'Lday') {
      hourFilter = ` AND (EXTRACT(HOUR FROM time) >= 6 AND EXTRACT(HOUR FROM time) < 18)`;
    } else if (type === 'Levening') {
      hourFilter = ` AND (EXTRACT(HOUR FROM time) >= 18 AND EXTRACT(HOUR FROM time) < 22)`;
    } else if (type === 'Lnight') {
      hourFilter = ` AND (EXTRACT(HOUR FROM time) >= 22 OR EXTRACT(HOUR FROM time) < 6)`;
    }
    
    const spatialFilter = `INTERSECTS(coordinate,POINT(${lng} ${lat}))`;
    const timeFilter = `time BETWEEN '${startTime}' AND '${endTime}'`;
    const combinedFilter = `${spatialFilter} AND ${timeFilter}${hourFilter}`;
    
    let maxFeatures = type === 'L1h' ? 60 : 10000;
    let sortBy = type === 'L1h' ? 'time+D' : 'time+A';
    
    const wfsUrl = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:noise_spatial_table&outputFormat=application/json&CQL_FILTER=${encodeURIComponent(combinedFilter)}&SORTBY=${sortBy}&maxFeatures=${maxFeatures}`;
    
    const response = await fetch(wfsUrl, {
      headers: {
        'Authorization': `Basic ${btoa('admin:geoserver')}`,
      },
    });
    
    const data = await response.json();
    // ... process data ...
    */

  } catch (err: any) {
    console.error("Error calculating LAeq:", err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

