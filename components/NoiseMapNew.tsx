"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Import Chart.js dynamically
let Chart: any = null;
if (typeof window !== "undefined") {
  import("chart.js/auto").then((module) => {
    Chart = module.default;
  });
}

// Configure Leaflet to use CDN for marker icons
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

interface NoiseFeature {
  properties: {
    id: number;
    noise_level: number;
    time: string;
    device_id?: string;
    battery?: number;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

export default function NoiseMapNew() {
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const hexLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [notification, setNotification] = useState<{message: string; type: 'error' | 'info' | null}>({message: '', type: null});
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchCacheRef = useRef<Map<string, any[]>>(new Map()); // Cache for faster response
  const chartInstanceRef = useRef<any>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showAIForm, setShowAIForm] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>("");
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [hoursPerDay, setHoursPerDay] = useState<string>("8");
  const [selectedLocation, setSelectedLocation] = useState<{lat: number; lon: number} | null>(null);
  const markerPopupRef = useRef<L.Marker | L.CircleMarker | null>(null); // Store marker reference for reopening popup
  const [followUpQuestion, setFollowUpQuestion] = useState<string>(""); // For follow-up questions
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false); // Loading state for follow-up
  const aiModalContentRef = useRef<HTMLDivElement | null>(null); // Ref for AI modal content container

  // Initialize map
  useEffect(() => {
    if (!mapInstance.current) {
      const timer = setTimeout(() => {
        const mapElement = document.getElementById("map");
        if (!mapElement) {
          console.error("Map container not found!");
          return;
        }

        // Base layers
        const terrainLayer = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            opacity: 0.8,
            minZoom: 5,
            attribution: "© OpenStreetMap contributors",
          }
        );

        const satelliteLayer = L.tileLayer(
          "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
          {
            maxZoom: 19,
            opacity: 0.8,
            minZoom: 5,
            subdomains: ["mt0", "mt1", "mt2", "mt3"],
            attribution: "© Google Maps",
          }
        );

        // Initialize map
        const map = L.map("map", {
          center: [13.756111, 100.516667],
          zoom: 13,
          minZoom: 10,
          maxZoom: 18,
          layers: [terrainLayer],
          zoomControl: true,
        });

        setTimeout(() => {
          map.invalidateSize();
        }, 100);

        // Layer controls
        const baseLayers = {
          Terrain: terrainLayer,
          Satellite: satelliteLayer,
        };

        L.control
          .layers(baseLayers, {}, { position: "topright" })
          .addTo(map);

        // Create hex layer using WMS TileLayer - automatically updates on map move/zoom
        if (!hexLayerRef.current) {
          const wmsUrl = "/api/geoserver-proxy/geoserver/it.geosolutions/wms";
          
          hexLayerRef.current = L.tileLayer.wms(wmsUrl, {
            layers: 'it.geosolutions:hex_005_e2f8',
            styles: 'hex_005_e2f8',
            format: 'image/png',
            transparent: true,
            version: '1.1.0',
            crs: L.CRS.EPSG4326,
            opacity: 0.9,
            attribution: 'Hex Noise Data'
          });
          
          hexLayerRef.current.addTo(map);
          console.log("[Hex Layer] WMS tile layer added to map");
        }

        // Marker layer
        const markers = L.layerGroup().addTo(map);
        markersRef.current = markers;

        // Handle map clicks - GetFeatureInfo to find hex
        map.on("click", async (e) => {
          const { lat, lng } = e.latlng;

          try {
            setIsLoadingData(true);
            // Don't show dashboard yet - wait until we confirm hex exists
            // GetFeatureInfo to find hex
            const wmsUrl = "/api/geoserver-proxy/geoserver/it.geosolutions/wms";
            const layer = "it.geosolutions:hex_005_e2f8";
            const bbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`;
            const point = map.latLngToContainerPoint(e.latlng);
            const size = map.getSize();
            const bounds = map.getBounds();
            const bboxString = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

            // Fix URL construction - use proper query parameter format
            // Ensure point coordinates are within image bounds
            const imageWidth = size.x;
            const imageHeight = size.y;
            const x = Math.max(0, Math.min(imageWidth - 1, Math.round(point.x)));
            const y = Math.max(0, Math.min(imageHeight - 1, Math.round(point.y)));
            
            console.log(`[GetFeatureInfo] Point: (${point.x}, ${point.y}), Image size: ${imageWidth}x${imageHeight}, Clamped: (${x}, ${y})`);
            
            // Use L.Util.getParamString to properly format query parameters
            const getFeatureInfoUrl =
              wmsUrl +
              L.Util.getParamString({
                service: "WMS",
                version: "1.1.1",
                request: "GetFeatureInfo",
                layers: layer,
                query_layers: layer,
                info_format: "application/json",
                x: x,
                y: y,
                srs: "EPSG:4326",
                width: imageWidth,
                height: imageHeight,
                bbox: bboxString,
              });

            console.log(`[GetFeatureInfo] Request URL: ${getFeatureInfoUrl}`);

            // Add timeout and retry mechanism for GetFeatureInfo
            let res;
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount <= maxRetries) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 seconds timeout
                
                res = await fetch(getFeatureInfoUrl, {
                  signal: controller.signal,
                });
                
                clearTimeout(timeoutId);
                break; // Success, exit retry loop
              } catch (fetchError: any) {
                if (fetchError.name === 'AbortError' && retryCount < maxRetries) {
                  console.warn(`[GetFeatureInfo] Timeout, retrying... (${retryCount + 1}/${maxRetries})`);
                  retryCount++;
                  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
                  continue;
                }
                throw fetchError; // Re-throw if not timeout or max retries reached
              }
            }
            
            if (!res || !res.ok) {
              let errorText = '';
              try {
                errorText = res ? await res.text() : 'No response received';
              } catch (e) {
                errorText = 'Unable to read error response';
              }
              
              console.error("❌ GetFeatureInfo failed:", res?.status || 'No response');
              console.error("❌ Error response:", errorText);
              
              // Try to parse error message
              let errorMessage = 'Unknown GeoServer error';
              if (errorText) {
                const errorMatch = errorText.match(/<ServiceException[^>]*>([^<]+)<\/ServiceException>/);
                if (errorMatch) {
                  errorMessage = errorMatch[1].trim();
                } else if (errorText.includes('timeout') || errorText.includes('Timeout')) {
                  errorMessage = 'Request timeout: GeoServer did not respond in time';
                }
              }
              console.error("❌ GeoServer Error:", errorMessage);
              
              // If dimension error, try using WFS instead as fallback
              if (errorMessage.includes("not in dimensions")) {
                console.log("⚠️ Dimension error detected, trying WFS query instead...");
                const wfsUrl = `/api/geoserver-proxy/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=${encodeURIComponent(layer)}&outputFormat=application/json&CQL_FILTER=INTERSECTS(geom,POINT(${lng} ${lat}))&maxFeatures=1`;
                const wfsRes = await fetch(wfsUrl);
                if (wfsRes.ok) {
                  const wfsJson = await wfsRes.json();
                  if (wfsJson.features && wfsJson.features.length > 0) {
                    console.log("✅ WFS fallback successful, using WFS result");
                    // Use WFS result instead
                    const feature = wfsJson.features[0];
                    
                    // Continue with existing code flow
                    const laeqFromHex = feature.properties?.laeq || feature.properties?.LAeq || null;
                    const laeq1h = laeqFromHex !== null ? parseFloat(laeqFromHex) : 0;
                    console.log("✅ Step 1 - Found hex polygon from WFS:");
                    console.log("  - Hex ID:", feature.properties?.hex_id || feature.id);
                    console.log("  - LAeq from hex:", laeq1h);
                    
                    if (laeq1h === 0) {
                      console.warn("No LAeq data found in hex");
                      setIsLoadingData(false);
                      setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

                    setShowDashboard(true);
                    setDashboardData({
                      noiseLevels: [],
                      labels: [],
                      laeq1h,
                      totalRecords: 0,
                      min: 0,
                      max: 0,
                    });
                    
                    // Extract polygon coordinates for WFS query
            const coordsList = feature.geometry.coordinates[0]
              .map((c: number[]) => `${c[0]} ${c[1]}`)
              .join(" ");

            // Query noise data with WFS
                    const wfsProxyUrl = "/api/wfs-proxy";
                    const wfsXml = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature service="WFS" version="1.1.0" outputFormat="application/json"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc">
  <wfs:Query typeName="it.geosolutions:noise_spatial_table">
    <ogc:Filter>
      <ogc:Intersects>
        <ogc:PropertyName>coordinate</ogc:PropertyName>
        <gml:Polygon srsName="EPSG:4326">
          <gml:exterior>
            <gml:LinearRing>
              <gml:posList>${coordsList}</gml:posList>
            </gml:LinearRing>
          </gml:exterior>
        </gml:Polygon>
      </ogc:Intersects>
    </ogc:Filter>
    <ogc:SortBy>
      <ogc:SortProperty>
        <ogc:PropertyName>time</ogc:PropertyName>
        <ogc:SortOrder>DESC</ogc:SortOrder>
      </ogc:SortProperty>
    </ogc:SortBy>
  </wfs:Query>
</wfs:GetFeature>`;

                    const res2 = await fetch(wfsProxyUrl, {
                      method: "POST",
                      headers: { "Content-Type": "text/xml" },
                      body: wfsXml.trim(),
                    });

                    if (!res2.ok) {
                      const errorText = await res2.text();
                      console.error("❌ WFS query failed:", res2.status);
                      setIsLoadingData(false);
                      return;
                    }

                    const data = await res2.text();
                    const trimmedData = data.trim();
                    
                    if (!trimmedData || trimmedData === '') {
                      console.error("WFS response is empty");
                      setIsLoadingData(false);
                      return;
                    }

                    let jsonData;
                    try {
                      jsonData = JSON.parse(trimmedData);
                    } catch (parseError) {
                      console.error("Failed to parse WFS response as JSON:", parseError);
                      setIsLoadingData(false);
                      return;
                    }

                    if (jsonData.features && jsonData.features.length > 0) {
                      const noiseLevels = jsonData.features.map((f: any) => f.properties.noise_level);
                      const labels = jsonData.features.map((f: any) => f.properties.time);
                      
                      setDashboardData({
                        noiseLevels,
                        labels,
                        laeq1h,
                        totalRecords: jsonData.features.length,
                        min: Math.min(...noiseLevels),
                        max: Math.max(...noiseLevels),
                      });
                    }
                    
                    setIsLoadingData(false);
                    return; // Exit early since we used WFS fallback
                  }
                }
              }
              
              // No hex found or error - don't show dashboard, just return silently
              console.log("No hex found at clicked location");
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

            if (!res) {
              throw new Error('GetFeatureInfo failed: No response received');
            }

            let json;
            try {
              const responseText = await res.text();
              
              // Check if response is empty
              if (!responseText || !responseText.trim()) {
                console.log("GetFeatureInfo response is empty - no hex found");
                setIsLoadingData(false);
                setShowDashboard(false); // Ensure dashboard is closed
                return; // Don't show dashboard if response is empty
              }

              // Check if response is JSON
              const trimmedText = responseText.trim();
              
              // Check if it's an XML error response
              if (trimmedText.startsWith('<?xml') || trimmedText.startsWith('<ServiceExceptionReport')) {
                // Parse XML error to extract error message
                const errorMatch = trimmedText.match(/<ServiceException[^>]*>([^<]+)<\/ServiceException>/i);
                const errorMessage = errorMatch ? errorMatch[1].trim() : 'Unknown GeoServer error';
                console.log("❌ GeoServer Error (no hex found):", errorMessage);
                setIsLoadingData(false);
                setShowDashboard(false); // Ensure dashboard is closed
                return; // Don't show dashboard on error
              }
              
              if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
                console.log("GetFeatureInfo response is not JSON - no hex found");
                setIsLoadingData(false);
                setShowDashboard(false); // Ensure dashboard is closed
                return; // Don't show dashboard on error
              }

              json = JSON.parse(trimmedText);
            } catch (parseError: any) {
              console.error("Failed to parse GetFeatureInfo response:", parseError.message);
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return; // Don't show anything if parse fails
            }

            if (!json.features || json.features.length === 0) {
              console.log("No hex found at clicked point");
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return; // Don't show dashboard if no hex found
            }

            const feature = json.features[0];
            
            // Step 1: Get LAeq from hex polygon (already calculated in materialized view)
            const laeqFromHex = feature.properties?.laeq || feature.properties?.LAeq || null;
            const laeq1h = laeqFromHex !== null ? parseFloat(laeqFromHex) : 0;
            console.log("✅ Step 1 - Found hex polygon:");
            console.log("  - Hex ID:", feature.properties?.hex_id || feature.id);
            console.log("  - LAeq from hex:", laeq1h);
            console.log("  - Hex properties:", feature.properties);
            
            // Only show dashboard after confirming hex exists
            setShowDashboard(true);
            setDashboardData({
              noiseLevels: [],
              labels: [],
              laeq1h,
              totalRecords: 0,
              min: 0,
              max: 0,
            });
            
            // Step 2: Extract polygon coordinates from hex feature
            const coordsList = feature.geometry.coordinates[0]
              .map((c: number[]) => `${c[0]} ${c[1]}`)
              .join(" ");
            console.log("✅ Step 2 - Using polygon coordinates to query WFS for all noise data in this polygon");

            // Step 3: Query noise data with WFS using the polygon (only for plotting chart, not for LAeq calculation)
            const wfsUrl = "/api/wfs-proxy";
            const wfsXml = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature service="WFS" version="1.1.0" outputFormat="application/json"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc">
  <wfs:Query typeName="it.geosolutions:noise_spatial_table">
    <ogc:Filter>
      <ogc:Intersects>
        <ogc:PropertyName>coordinate</ogc:PropertyName>
        <gml:Polygon srsName="EPSG:4326">
          <gml:exterior>
            <gml:LinearRing>
              <gml:posList>${coordsList}</gml:posList>
            </gml:LinearRing>
          </gml:exterior>
        </gml:Polygon>
      </ogc:Intersects>
    </ogc:Filter>
    <ogc:SortBy>
      <ogc:SortProperty>
        <ogc:PropertyName>time</ogc:PropertyName>
        <ogc:SortOrder>DESC</ogc:SortOrder>
      </ogc:SortProperty>
    </ogc:SortBy>
  </wfs:Query>
</wfs:GetFeature>`;

            const res2 = await fetch(wfsUrl, {
              method: "POST",
              headers: { "Content-Type": "text/xml" },
              body: wfsXml.trim(),
            });

            if (!res2.ok) {
              const errorText = await res2.text();
              console.error("❌ WFS query failed:", res2.status);
              console.error("❌ Error response:", errorText);
              
              // Don't show notification or dashboard when WFS query fails
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

            const data = await res2.text();
            
            // Check if response is empty or not JSON
            if (!data || !data.trim()) {
              console.error("WFS response is empty");
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

            // Check if response is JSON (starts with { or [)
            const trimmedData = data.trim();
            if (!trimmedData.startsWith('{') && !trimmedData.startsWith('[')) {
              console.error("WFS response is not JSON. Response:", trimmedData.substring(0, 200));
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

            let jsonData;
            try {
              jsonData = JSON.parse(trimmedData);
            } catch (parseError: any) {
              console.error("Failed to parse WFS response as JSON:", parseError.message);
              console.error("Response content:", trimmedData.substring(0, 500));
              setIsLoadingData(false);
              setShowDashboard(false); // Ensure dashboard is closed
              return;
            }

            if (jsonData.features && jsonData.features.length > 0) {
              console.log("✅ Step 3 - Got noise data from WFS query:");
              console.log("  - Total records in polygon:", jsonData.features.length);
              console.log("  - Polygon coordinates used:", coordsList.substring(0, 100) + "...");
              
              // Process data for dashboard (only for plotting chart)
              const noiseLevels = jsonData.features.map(
                (f: any) => f.properties.noise_level
              );
              // Use time from data directly (already in correct format from database)
              const labels = jsonData.features.map((f: any) =>
                f.properties.time
              );

              // Step 4: Update dashboard with chart data (LAeq already shown)
              console.log("✅ Step 4 - Updating chart with noise data, LAeq already displayed:", laeq1h);

              setDashboardData({
                noiseLevels: noiseLevels.reverse(),
                labels: labels.reverse(),
                laeq1h, // Keep LAeq from hex (already set)
                totalRecords: noiseLevels.length,
                min: Math.min(...noiseLevels),
                max: Math.max(...noiseLevels),
              });
            }
          } catch (err: any) {
            console.error("Error:", err);
            // Don't show alert or dashboard when clicking on non-hex areas
            setIsLoadingData(false);
            setShowDashboard(false); // Ensure dashboard is closed
          } finally {
            setIsLoadingData(false);
          }
        });

        mapInstance.current = map;
        console.log("✅ Map initialized successfully");
      }, 100);

      return () => {
        clearTimeout(timer);
        if (mapInstance.current) {
          mapInstance.current.remove();
          mapInstance.current = null;
        }
      };
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Load markers
  useEffect(() => {
    if (mapInstance.current && markersRef.current) {
      const url =
        "/api/geoserver-proxy/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:current_noise&outputFormat=application/json";

      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (markersRef.current) {
            markersRef.current.clearLayers();
          }

          if (data.features && data.features.length > 0) {
            data.features.forEach((feature: NoiseFeature) => {
              const [lng, lat] = feature.geometry.coordinates;
              const noiseLevel = feature.properties.noise_level;
              const time = new Date(feature.properties.time).toLocaleString();

              const marker = L.circleMarker([lat, lng], {
                radius: 10,
                fillColor: getMarkerColor(noiseLevel),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
              }).addTo(markersRef.current!);

              const popupContent = `
                <div style="min-width: 250px; padding: 15px;">
                  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 8px; background: #f3f4f6; border-radius: 8px;">
                    <div style="font-size: 14px; font-weight: 600;">
                      ID: ${feature.properties.id} | TonkitLab
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; margin-left: auto;">
                      <i class="fa fa-battery-full" style="color: #22c55e;"></i>
                      <span style="font-size: 12px; font-weight: 600;">100%</span>
                    </div>
                  </div>
                  <p style="margin: 8px 0;">
                    <span style="font-weight: 700; color: #374151;">Noise Level:</span>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; margin-left: 8px;">
                      ${noiseLevel} dB(A)
                    </span>
                  </p>
                  <p style="margin: 8px 0; color: #6b7280;">
                    <i class="fa fa-clock" style="margin-right: 5px;"></i>
                    <span style="font-weight: 600;">Latest Time:</span> ${time}
                  </p>
                  <button 
                    class="popup-btn-${feature.properties.id}"
                    style="
                      width: 100%;
                      margin-top: 10px;
                      padding: 10px 20px;
                      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
                      color: white;
                      border: none;
                      border-radius: 8px;
                      font-weight: 600;
                      cursor: pointer;
                      transition: all 0.2s;
                    "
                  >
                    More Info <i class="fa-solid fa-eye" style="margin-left: 5px;"></i>
                  </button>
                  <button 
                    class="popup-ai-btn-${feature.properties.id}"
                    style="
                      width: 100%;
                      margin-top: 8px;
                      padding: 10px 20px;
                      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                      color: white;
                      border: none;
                      border-radius: 8px;
                      font-weight: 600;
                      cursor: pointer;
                      transition: all 0.2s;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      gap: 8px;
                    "
                  >
                    <i class="fa fa-robot"></i>
                    <span>ถาม AI เกี่ยวกับระดับเสียง</span>
                  </button>
                </div>
              `;

              marker.bindPopup(popupContent);
              console.log(`[MARKER ${feature.properties.id}] Popup bound`);

              // Function to attach event listeners - called every time popup opens
              const attachPopupListeners = () => {
                console.log(`[MARKER ${feature.properties.id}] 🔵 POPUP OPEN - Starting to attach listeners`);
                
                // Use multiple attempts with increasing delays to ensure DOM is ready
                const tryAttach = (attempt = 0) => {
                  console.log(`[MARKER ${feature.properties.id}] Try attach attempt ${attempt + 1}/10`);
                  
                  const popupContainer = marker.getPopup()?.getElement();
                  if (!popupContainer && attempt < 10) {
                    console.log(`[MARKER ${feature.properties.id}] Popup container not found, retrying...`);
                    setTimeout(() => tryAttach(attempt + 1), 50);
                    return;
                  }
                  
                  if (!popupContainer) {
                    console.error(`[MARKER ${feature.properties.id}] ❌ Popup container not found after ${attempt} attempts`);
                    return;
                  }
                  
                  console.log(`[MARKER ${feature.properties.id}] ✅ Popup container found`);
                  
                  // Find buttons within the popup container
                  const btn = popupContainer.querySelector(
                    `.popup-btn-${feature.properties.id}`
                  ) as HTMLElement;
                  
                  if (btn) {
                    console.log(`[MARKER ${feature.properties.id}] ✅ Found More Info button`);
                    // Remove old listener by cloning
                    const newBtn = btn.cloneNode(true) as HTMLElement;
                    btn.parentNode?.replaceChild(newBtn, btn);
                    newBtn.addEventListener("click", (e) => {
                      console.log(`[MARKER ${feature.properties.id}] More Info button clicked`);
                      e.preventDefault();
                      e.stopPropagation();
                      fetchMarkerData(feature.properties.id, lat, lng);
                    });
                    console.log(`[MARKER ${feature.properties.id}] ✅ More Info button listener attached`);
                  } else {
                    console.warn(`[MARKER ${feature.properties.id}] ⚠️ More Info button not found`);
                  }
                  
                  const aiBtn = popupContainer.querySelector(
                    `.popup-ai-btn-${feature.properties.id}`
                  ) as HTMLElement;
                  
                  if (aiBtn) {
                    console.log(`[MARKER ${feature.properties.id}] ✅ Found AI button`);
                    // Remove old listener by cloning
                    const newAiBtn = aiBtn.cloneNode(true) as HTMLElement;
                    aiBtn.parentNode?.replaceChild(newAiBtn, aiBtn);
                    newAiBtn.addEventListener("click", (e) => {
                      console.log(`[MARKER ${feature.properties.id}] 🤖 AI button clicked!`);
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // Store marker reference to reopen popup later
                      markerPopupRef.current = marker;
                      console.log(`[MARKER ${feature.properties.id}] Marker reference stored`);
                      
                      // Close dashboard when asking AI
                      setShowDashboard(false);
                      setDashboardData(null);
                      setIsLoadingData(false);
                      if (chartInstanceRef.current) {
                        chartInstanceRef.current.destroy();
                        chartInstanceRef.current = null;
                      }
                      // Close popup first
                      marker.closePopup();
                      console.log(`[MARKER ${feature.properties.id}] Popup closed, opening AI form`);
                      // Open AI form (pass marker reference)
                      handleAskAI(lat, lng, marker);
                    });
                    console.log(`[MARKER ${feature.properties.id}] ✅ AI button listener attached`);
                  } else {
                    console.error(`[MARKER ${feature.properties.id}] ❌ AI button not found!`);
                    console.log(`[MARKER ${feature.properties.id}] Popup container HTML:`, popupContainer.innerHTML.substring(0, 500));
                  }
                  
                  console.log(`[MARKER ${feature.properties.id}] ✅ Finished attaching listeners`);
                };
                
                tryAttach();
              };

              // Remove any existing listeners first
              marker.off("popupopen");
              marker.off("popupclose");
              
              // Log when popup closes and remove marker
              marker.on("popupclose", () => {
                console.log(`[MARKER ${feature.properties.id}] 🔴 POPUP CLOSED - Removing marker`);
                // Remove marker from map when popup closes
                if (markersRef.current && marker) {
                  markersRef.current.removeLayer(marker);
                }
              });
              
              // Attach listeners when popup opens (every time it opens)
              marker.on("popupopen", attachPopupListeners);
              console.log(`[MARKER ${feature.properties.id}] ✅ popupopen event listener registered`);
            });
          }
        })
        .catch((err) => {
          console.error("Error fetching markers:", err);
        });
    }
  }, []);

  // Fetch marker detailed data
  const fetchMarkerData = async (id: number, lat: number, lng: number) => {
    try {
      setIsLoadingData(true);
      setShowDashboard(true); // Show dashboard immediately with loading state
      
      const url = `/api/geoserver-proxy/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:noise_spatial_table&outputFormat=application/json&CQL_FILTER=INTERSECTS(coordinate,POINT(${lng} ${lat}))&SORTBY=time+D&maxFeatures=60`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const noiseLevels = data.features.map(
          (f: any) => f.properties.noise_level
        );
        // Use time from data directly (already in correct format from database)
        const labels = data.features.map((f: any) =>
          f.properties.time
        );

        // Use LAeq from hex feature (already calculated in materialized view)
        // Comment: LAeq calculation is done in the database materialized view
        // const calculateLAeq = (levels: number[]): number => {
        //   if (levels.length === 0) return 0;
        //   const sum = levels.reduce(
        //     (acc, val) => acc + Math.pow(10, val / 10),
        //     0
        //   );
        //   return 10 * Math.log10(sum / levels.length);
        // };
        // const laeq1h = calculateLAeq(noiseLevels);

        // Get LAeq from hex layer (already calculated in materialized view)
        // Query hex layer to get LAeq for this location
        let laeq1h = 0;
        try {
          const hexWmsUrl = "/api/geoserver-proxy/geoserver/it.geosolutions/wms";
          const hexLayer = "it.geosolutions:hex_005_e2f8";
          const point = { x: 50, y: 50 }; // Approximate point for GetFeatureInfo
          const hexBbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`;
          
          // Use L.Util.getParamString to properly format query parameters
          const hexGetFeatureInfoUrl =
            hexWmsUrl +
            L.Util.getParamString({
              service: "WMS",
              version: "1.1.1",
              request: "GetFeatureInfo",
              layers: hexLayer,
              query_layers: hexLayer,
              info_format: "application/json",
              x: point.x,
              y: point.y,
              srs: "EPSG:4326",
              width: 101,
              height: 101,
              bbox: hexBbox,
            });
          
          // Add timeout and retry mechanism for hexGetFeatureInfo
          let hexRes;
          let hexRetryCount = 0;
          const hexMaxRetries = 2;
          
          while (hexRetryCount <= hexMaxRetries) {
            try {
              const hexController = new AbortController();
              const hexTimeoutId = setTimeout(() => hexController.abort(), 45000); // 45 seconds timeout
              
              hexRes = await fetch(hexGetFeatureInfoUrl, {
                signal: hexController.signal,
              });
              
              clearTimeout(hexTimeoutId);
              break; // Success, exit retry loop
            } catch (hexFetchError: any) {
              if (hexFetchError.name === 'AbortError' && hexRetryCount < hexMaxRetries) {
                console.warn(`[hexGetFeatureInfo] Timeout, retrying... (${hexRetryCount + 1}/${hexMaxRetries})`);
                hexRetryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
                continue;
              }
              throw hexFetchError; // Re-throw if not timeout or max retries reached
            }
          }
          
          if (hexRes && hexRes.ok) {
            const hexJson = await hexRes.json();
            if (hexJson.features && hexJson.features.length > 0) {
              const hexFeature = hexJson.features[0];
              const laeqFromHex = hexFeature.properties?.laeq || hexFeature.properties?.LAeq || null;
              if (laeqFromHex !== null) {
                laeq1h = parseFloat(laeqFromHex);
                console.log("LAeq from hex (marker click):", laeq1h);
              }
            }
          }
        } catch (hexError) {
          console.warn("Could not get LAeq from hex layer, using 0:", hexError);
        }
        

        setDashboardData({
          noiseLevels: noiseLevels.reverse(),
          labels: labels.reverse(),
          laeq1h,
          totalRecords: noiseLevels.length,
          min: Math.min(...noiseLevels),
          max: Math.max(...noiseLevels),
        });
      }
    } catch (error) {
      console.error("Error fetching marker data:", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Function to downsample data for smooth visualization
  // Memoized downsample function for chart performance
  const downsampleData = useCallback((data: number[], labels: string[], maxPoints: number = 100) => {
    if (data.length <= maxPoints) {
      return { data, labels };
    }
    
    const step = Math.ceil(data.length / maxPoints);
    const downsampledData: number[] = [];
    const downsampledLabels: string[] = [];
    
    for (let i = 0; i < data.length; i += step) {
      // Take average of points in this step for smoother trend
      const chunk = data.slice(i, Math.min(i + step, data.length));
      const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
      downsampledData.push(avg);
      downsampledLabels.push(labels[i]);
    }
    
    // Always include last point
    if (downsampledLabels[downsampledLabels.length - 1] !== labels[labels.length - 1]) {
      downsampledData.push(data[data.length - 1]);
      downsampledLabels.push(labels[labels.length - 1]);
    }
    
    return { data: downsampledData, labels: downsampledLabels };
  }, []);

  // Render chart when dashboard data is available
  useEffect(() => {
    if (showDashboard && dashboardData && typeof window !== "undefined" && Chart) {
      const timer = setTimeout(async () => {
        // Ensure Chart.js is loaded
        if (!Chart) {
          const chartModule = await import("chart.js/auto");
          Chart = chartModule.default;
        }

        const canvas = document.getElementById("noiseChart") as HTMLCanvasElement;
        if (!canvas || !Chart) return;

        if (chartInstanceRef.current) {
          chartInstanceRef.current.destroy();
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Downsample data if too many points for smooth visualization
        const maxPoints = 150; // จำกัดจำนวนจุดเพื่อให้ smooth
        const chartData = dashboardData.noiseLevels.length > maxPoints
          ? downsampleData(dashboardData.noiseLevels, dashboardData.labels, maxPoints)
          : { data: dashboardData.noiseLevels, labels: dashboardData.labels };

        // Hide points if too many data points
        const shouldHidePoints = chartData.data.length > 50;

        // คำนวณ index ที่ต้องการแสดง (4 จุด: เริ่ม, 1/3, 2/3, สุดท้าย)
        const totalLabels = chartData.labels.length;
        const targetIndices = totalLabels > 0 ? [
          0,
          Math.floor(totalLabels / 3),
          Math.floor(totalLabels * 2 / 3),
          totalLabels - 1
        ] : [];

        // สร้าง gradient สวยงาม
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
        gradient.addColorStop(0, "rgba(59, 130, 246, 0.4)");
        gradient.addColorStop(0.5, "rgba(59, 130, 246, 0.2)");
        gradient.addColorStop(1, "rgba(59, 130, 246, 0.05)");

        chartInstanceRef.current = new Chart(ctx, {
          type: "line",
          data: {
            labels: chartData.labels,
            datasets: [
              {
                label: "Noise Levels (dB)",
                data: chartData.data,
                borderColor: "rgba(59, 130, 246, 1)",
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.7, // เพิ่ม tension ให้ smooth มากขึ้น
                pointRadius: 0, // ซ่อนจุดทั้งหมดเพื่อให้เห็น trend ชัดเจน
                pointHoverRadius: 6,
                pointBackgroundColor: 'rgba(59, 130, 246, 0.8)',
                pointBorderColor: "#ffffff",
                pointBorderWidth: 2,
                shadowOffsetX: 0,
                shadowOffsetY: 2,
                shadowBlur: 4,
                shadowColor: "rgba(59, 130, 246, 0.3)",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
              padding: {
                left: 5,
                right: 5,
                top: 10,
                bottom: 10
              }
            },
            animation: {
              duration: 1200,
              easing: "easeInOutQuart"
            },
            interaction: {
              intersect: false,
              mode: 'index'
            },
            plugins: {
              legend: {
                display: true,
                position: "top",
                labels: {
                  usePointStyle: true,
                  pointStyle: "circle",
                  padding: 15,
                  font: {
                    size: 12,
                    weight: "bold",
                    family: "'Inter', 'Segoe UI', sans-serif"
                  },
                  color: "#374151"
                }
              },
              tooltip: {
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                padding: 12,
                titleFont: {
                  size: 13,
                  weight: "bold",
                  family: "'Inter', 'Segoe UI', sans-serif"
                },
                bodyFont: {
                  size: 12,
                  weight: "normal",
                  family: "'Inter', 'Segoe UI', sans-serif"
                },
                borderColor: "rgba(59, 130, 246, 0.5)",
                borderWidth: 2,
                displayColors: true,
                cornerRadius: 8,
                boxPadding: 6,
                callbacks: {
                  label: function(context: any) {
                    return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)} dB(A)`;
                  }
                }
              },
            },
            scales: {
              y: {
                beginAtZero: false,
                grid: {
                  color: "rgba(0, 0, 0, 0.06)",
                  lineWidth: 1,
                },
                ticks: {
                  font: {
                    size: 11,
                    weight: "normal",
                    family: "'Inter', 'Segoe UI', sans-serif"
                  },
                  color: "#6b7280",
                  padding: 8,
                },
                title: {
                  display: true,
                  text: "Noise Level (dB)",
                  font: {
                    size: 13,
                    weight: "bold",
                    family: "'Inter', 'Segoe UI', sans-serif"
                  },
                  color: "#374151",
                  padding: {
                    top: 5,
                    bottom: 15
                  }
                },
              },
              x: {
                display: true,
                offset: false, // ไม่มี offset เพื่อให้กราฟเต็มพื้นที่
                min: 0, // เริ่มจากจุดแรก
                max: totalLabels > 0 ? totalLabels - 1 : undefined, // จบที่จุดสุดท้าย
                grid: {
                  offset: false,
                },
                title: {
                  display: false,
                },
                afterBuildTicks: function(axis: any) {
                  if (totalLabels === 0) return;
                  
                  // สร้าง ticks ใหม่เฉพาะ 4 จุดที่ต้องการ
                  const newTicks: any[] = [];
                  targetIndices.forEach((labelIndex) => {
                    if (labelIndex < totalLabels) {
                      newTicks.push({
                        value: labelIndex,
                        label: chartData.labels[labelIndex]
                      });
                    }
                  });
                  
                  axis.ticks = newTicks;
                },
                ticks: {
                  maxTicksLimit: 4,
                  autoSkip: false,
                  maxRotation: 45,
                  minRotation: 30, // เอียง labels อย่างน้อย 30 องศา
                  font: {
                    size: 11,
                    weight: "normal",
                    family: "'Inter', 'Segoe UI', sans-serif"
                  },
                  color: "#6b7280",
                  padding: 10,
                  callback: function(value: any, index: number, ticks: any[]) {
                    const tick = ticks[index];
                    if (!tick || !tick.label) return '';
                    
                    try {
                      // Parse date from ISO string or timestamp
                      const date = new Date(tick.label);
                      
                      // Check if date is valid
                      if (isNaN(date.getTime())) {
                        return '';
                      }
                      
                      // แสดงทั้งวันที่และเวลา รวมปีด้วย และขึ้นบรรทัดใหม่
                      const dateStr = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      });
                      const timeStr = date.toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false
                      });
                      
                      // ใช้ array ของ strings เพื่อให้ Chart.js render เป็น multiline
                      return [dateStr, timeStr];
                    } catch (error) {
                      console.warn('Date formatting error:', error, 'Label:', tick.label);
                      return '';
                    }
                  }
                }
              },
            },
          },
        });
      }, 200);

      return () => clearTimeout(timer);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [showDashboard, dashboardData]);

  // Memoized search function with caching
  const handleSearch = useCallback(async (query?: string, showSuggestionsOnly: boolean = false) => {
    const queryToSearch = query || searchQuery.trim();
    if (!queryToSearch || !mapInstance.current) {
      setSearchResults([]);
      setShowSuggestions(false);
      return;
    }
    
    // Check cache first for instant response
    const cacheKey = queryToSearch.toLowerCase().trim();
    if (searchCacheRef.current.has(cacheKey)) {
      const cachedResults = searchCacheRef.current.get(cacheKey);
      if (cachedResults && cachedResults.length > 0) {
        setSearchResults(cachedResults);
        setShowSuggestions(true);
        return; // Return immediately from cache
      }
    }
    
    setIsSearching(true);
    
    try {
      // Use Nominatim API through Next.js API proxy to avoid CORS issues
      const encodedQuery = encodeURIComponent(queryToSearch);
      const url = `/api/nominatim-proxy?q=${encodedQuery}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        // Handle rate limit or service unavailable
        if (response.status === 429) {
          const errorData = await response.json().catch(() => ({}));
          console.warn('⚠️ Search service rate limited, please try again later');
          if (!showSuggestionsOnly) {
            setNotification({message: 'การค้นหาถูกจำกัดจำนวนครั้ง กรุณารอสักครู่แล้วลองใหม่', type: 'error'});
            setTimeout(() => {
              setNotification({message: '', type: null});
            }, 4000);
          }
          setSearchResults([]);
          setShowSuggestions(false);
          return;
        }
        throw new Error(`Search failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Check if response is an error
      if (data.error) {
        console.error('Search API error:', data.error);
        if (!showSuggestionsOnly) {
          setNotification({message: data.error || 'เกิดข้อผิดพลาดในการค้นหา', type: 'error'});
          setTimeout(() => {
            setNotification({message: '', type: null});
          }, 4000);
        }
        setSearchResults([]);
        setShowSuggestions(false);
        return;
      }
      
      // Optimize: Process results faster - simplified processing
      const enhancedResults = data.map((result: any) => {
        const address = result.address || {};
        
        // Fast extract Thai name - single expression
        const thaiName = result.namedetails?.name_th || 
                        result.localname || 
                        address.name || 
                        result.display_name.split(',')[0].trim();
        
        // Build complete detailed address in Thai - all available information
        const addressParts = [];
        
        // House/Building number
        if (address.house_number) addressParts.push(`เลขที่ ${address.house_number}`);
        
        // Road/Street
        if (address.road) addressParts.push(`ถนน${address.road}`);
        else if (address.street) addressParts.push(`ถนน${address.street}`);
        
        // Sub-locality (แขวง, ตำบล, หมู่บ้าน)
        if (address.suburb) addressParts.push(`แขวง${address.suburb}`);
        else if (address.village) addressParts.push(`แขวง${address.village}`);
        else if (address.quarter) addressParts.push(`แขวง${address.quarter}`);
        else if (address.town) addressParts.push(`ตำบล${address.town}`);
        
        // District (เขต, อำเภอ)
        if (address.city_district) addressParts.push(`เขต${address.city_district}`);
        else if (address.district) addressParts.push(`เขต${address.district}`);
        else if (address.county) addressParts.push(`อำเภอ${address.county}`);
        
        // City/Town
        if (address.city) addressParts.push(`เมือง${address.city}`);
        else if (address.town && !addressParts.some(p => p.includes(address.town))) {
          addressParts.push(`เมือง${address.town}`);
        }
        
        // Province/State
        if (address.province) addressParts.push(`จังหวัด${address.province}`);
        else if (address.state) addressParts.push(`จังหวัด${address.state}`);
        
        // Postal code
        if (address.postcode) addressParts.push(`รหัสไปรษณีย์ ${address.postcode}`);
        
        // Country (usually Thailand)
        if (address.country && address.country !== 'Thailand') {
          addressParts.push(address.country);
        }
        
        return {
          ...result,
          thaiName,
          fullAddress: addressParts.join(', '),
          displayName: result.display_name,
          addressDetails: address // Keep full address object for popup
        };
      });
      
      // Cache results for faster future searches
      if (enhancedResults.length > 0) {
        searchCacheRef.current.set(cacheKey, enhancedResults);
        // Limit cache size to prevent memory issues
        if (searchCacheRef.current.size > 50) {
          const firstKey = searchCacheRef.current.keys().next().value;
          if (firstKey) {
            searchCacheRef.current.delete(firstKey);
          }
        }
      }
      
      if (showSuggestionsOnly) {
        setSearchResults(enhancedResults);
        setShowSuggestions(true);
      } else {
        if (enhancedResults.length === 0) {
          // Show beautiful notification instead of alert
          setNotification({message: 'ไม่พบสถานที่ที่ค้นหา กรุณาลองค้นหาด้วยคำอื่น', type: 'error'});
          setShowSuggestions(false);
          // Auto hide notification after 4 seconds
          setTimeout(() => {
            setNotification({message: '', type: null});
          }, 4000);
        } else if (enhancedResults.length === 1) {
          const result = enhancedResults[0];
          handleSelectLocation(
            parseFloat(result.lat),
            parseFloat(result.lon),
            result.thaiName || result.display_name,
            result.fullAddress,
            result.addressDetails || result.address
          );
        } else {
          setSearchResults(enhancedResults);
          setShowSuggestions(true);
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      if (!showSuggestionsOnly) {
        setNotification({message: 'เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง', type: 'error'});
        setTimeout(() => {
          setNotification({message: '', type: null});
        }, 4000);
      }
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, mapInstance]);

  // Memoized input change handler with debounce
  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (!value.trim()) {
      setSearchResults([]);
      setShowSuggestions(false);
      setIsSearching(false);
      return;
    }
    
    // Wait for user to stop typing before searching
    // Use 500ms debounce to ensure user has stopped typing
    // This prevents searching while user is still typing fast
    const trimmedValue = value.trim();
    if (trimmedValue.length >= 2) {
      // Wait 500ms after user stops typing before searching
      searchTimeoutRef.current = setTimeout(() => {
        // Use closure to capture current value
        const currentValue = value.trim();
        // Only search if we still have at least 2 characters
        if (currentValue.length >= 2) {
          handleSearch(currentValue, true);
        }
      }, 500); // Wait 500ms after user stops typing
    } else {
      // Clear results if less than 2 characters
      setSearchResults([]);
      setShowSuggestions(false);
      setIsSearching(false);
    }
  }, [handleSearch]);

  // Memoized location selection handler
  const handleSelectLocation = useCallback((lat: number, lon: number, name: string, fullAddress?: string, addressDetails?: any) => {
    if (!mapInstance.current) return;
    
    if (searchMarkerRef.current) {
      mapInstance.current.removeLayer(searchMarkerRef.current);
    }
    
    // Build beautiful modern popup with elegant design
    let popupContent = `<div style="min-width: 340px; max-width: 420px; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05);">`;
    
    // Elegant header with gradient
    popupContent += `<div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%); padding: 24px; color: white;">`;
    popupContent += `<div style="display: flex; align-items: center; gap: 14px;">`;
    // Icon container with glassmorphism
    popupContent += `<div style="width: 56px; height: 56px; background: rgba(255,255,255,0.3); border-radius: 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(20px); box-shadow: 0 8px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.2);">`;
    popupContent += `<i class="fa fa-map-marker-alt" style="font-size: 24px; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.2);"></i>`;
    popupContent += `</div>`;
    popupContent += `<div style="flex: 1; min-width: 0;">`;
    
    if (addressDetails) {
      const roadName = addressDetails.road || '';
      const displayName = roadName || name;
      popupContent += `<div style="font-size: 20px; font-weight: 800; margin-bottom: 2px; text-shadow: 0 2px 8px rgba(0,0,0,0.3); line-height: 1.2; word-wrap: break-word; letter-spacing: -0.3px;">${displayName}</div>`;
    } else {
      popupContent += `<div style="font-size: 20px; font-weight: 800; margin-bottom: 2px; text-shadow: 0 2px 8px rgba(0,0,0,0.3); line-height: 1.2; word-wrap: break-word; letter-spacing: -0.3px;">${name}</div>`;
    }
    
    popupContent += `</div></div></div></div>`;
    
    // Clean white content area
    popupContent += `<div style="padding: 20px; background: linear-gradient(to bottom, #ffffff, #fafafa);">`;
    
    if (addressDetails) {
      const addressParts = [];
      const roadName = addressDetails.road || '';
      if (roadName) {
        addressParts.push(`ถนน${roadName}`);
      }
      if (addressDetails.suburb) {
        addressParts.push(`แขวง${addressDetails.suburb}`);
      } else if (addressDetails.village) {
        addressParts.push(`แขวง${addressDetails.village}`);
      } else if (addressDetails.quarter) {
        addressParts.push(`แขวง${addressDetails.quarter}`);
      }
      if (addressDetails.city_district) {
        addressParts.push(`เขต${addressDetails.city_district}`);
      } else if (addressDetails.district) {
        addressParts.push(`เขต${addressDetails.district}`);
      }
      if (addressDetails.city) {
        addressParts.push(`เมือง${addressDetails.city}`);
      } else if (addressDetails.town) {
        addressParts.push(`เมือง${addressDetails.town}`);
      }
      if (addressDetails.postcode) {
        addressParts.push(`รหัสไปรษณีย์ ${addressDetails.postcode}`);
      }
      addressParts.push('ประเทศไทย');
      
      if (addressParts.length > 0) {
        popupContent += `<div style="background: white; border: 1px solid #e5e7eb; border-left: 5px solid #6366f1; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05); transition: all 0.2s;">`;
        popupContent += `<div style="display: flex; align-items: flex-start; gap: 14px;">`;
        popupContent += `<div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(99,102,241,0.3);">`;
        popupContent += `<i class="fa fa-home" style="font-size: 16px; color: white;"></i>`;
        popupContent += `</div>`;
        popupContent += `<div style="flex: 1; line-height: 1.8;">`;
        popupContent += `<div style="font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">ที่อยู่</div>`;
        popupContent += `<div style="font-size: 15px; color: #111827; font-weight: 500; line-height: 1.6;">${addressParts.join(', ')}</div>`;
        popupContent += `</div></div></div>`;
      }
      
      if (lat && lon) {
        popupContent += `<div style="background: white; border: 1px solid #e5e7eb; border-left: 5px solid #f59e0b; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);">`;
        popupContent += `<div style="display: flex; align-items: center; gap: 14px;">`;
        popupContent += `<div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b, #f97316); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(245,158,11,0.3);">`;
        popupContent += `<i class="fa fa-globe" style="font-size: 16px; color: white;"></i>`;
        popupContent += `</div>`;
        popupContent += `<div style="flex: 1;">`;
        popupContent += `<div style="font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">พิกัด</div>`;
        popupContent += `<div style="font-size: 14px; color: #1f2937; font-family: 'SF Mono', 'Monaco', 'Courier New', monospace; font-weight: 700; letter-spacing: 0.5px; background: #f9fafb; padding: 8px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>`;
        popupContent += `</div></div></div>`;
      }
    } else if (fullAddress) {
      popupContent += `<div style="background: white; border: 1px solid #e5e7eb; border-left: 5px solid #6366f1; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);">`;
      popupContent += `<div style="display: flex; align-items: flex-start; gap: 14px;">`;
      popupContent += `<div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(99,102,241,0.3);">`;
      popupContent += `<i class="fa fa-home" style="font-size: 16px; color: white;"></i>`;
      popupContent += `</div>`;
      popupContent += `<div style="flex: 1; line-height: 1.8;">`;
      popupContent += `<div style="font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">ที่อยู่</div>`;
      popupContent += `<div style="font-size: 15px; color: #111827; font-weight: 500; line-height: 1.6;">${fullAddress}</div>`;
      popupContent += `</div></div></div>`;
      if (lat && lon) {
        popupContent += `<div style="background: white; border: 1px solid #e5e7eb; border-left: 5px solid #f59e0b; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);">`;
        popupContent += `<div style="display: flex; align-items: center; gap: 14px;">`;
        popupContent += `<div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b, #f97316); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(245,158,11,0.3);">`;
        popupContent += `<i class="fa fa-globe" style="font-size: 16px; color: white;"></i>`;
        popupContent += `</div>`;
        popupContent += `<div style="flex: 1;">`;
        popupContent += `<div style="font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">พิกัด</div>`;
        popupContent += `<div style="font-size: 14px; color: #1f2937; font-family: 'SF Mono', 'Monaco', 'Courier New', monospace; font-weight: 700; letter-spacing: 0.5px; background: #f9fafb; padding: 8px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>`;
        popupContent += `</div></div></div>`;
      }
    } else {
      if (lat && lon) {
        popupContent += `<div style="background: white; border: 1px solid #e5e7eb; border-left: 5px solid #f59e0b; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);">`;
        popupContent += `<div style="display: flex; align-items: center; gap: 14px;">`;
        popupContent += `<div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b, #f97316); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(245,158,11,0.3);">`;
        popupContent += `<i class="fa fa-globe" style="font-size: 16px; color: white;"></i>`;
        popupContent += `</div>`;
        popupContent += `<div style="flex: 1;">`;
        popupContent += `<div style="font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">พิกัด</div>`;
        popupContent += `<div style="font-size: 14px; color: #1f2937; font-family: 'SF Mono', 'Monaco', 'Courier New', monospace; font-weight: 700; letter-spacing: 0.5px; background: #f9fafb; padding: 8px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>`;
        popupContent += `</div></div></div>`;
      }
    }
    
    // Add AI Ask button
    const buttonId = `ask-ai-btn-${lat}-${lon}-${Date.now()}`;
    popupContent += `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">`;
    popupContent += `<button id="${buttonId}" style="width: 100%; padding: 12px 20px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(99,102,241,0.3); display: flex; align-items: center; justify-content: center; gap: 8px;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(99,102,241,0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(99,102,241,0.3)'">`;
    popupContent += `<i class="fa fa-robot" style="font-size: 16px;"></i>`;
    popupContent += `<span>ถาม AI เกี่ยวกับระดับเสียง</span>`;
    popupContent += `</button>`;
    popupContent += `</div>`;
    
    popupContent += `</div></div>`;
    
    const marker = L.marker([lat, lon], {
      icon: L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [0, 0], // Position popup just above marker, not too far
      })
    }).addTo(mapInstance.current);
    
    // Use popup options to position it closer to marker
    const popup = L.popup({
      offset: L.point(0, -45), // Reduced offset to bring popup closer to marker
      className: 'custom-popup', // Add custom class for styling if needed
      maxWidth: 420,
      autoPan: true, // Auto pan map to keep popup visible
      autoPanPadding: L.point(50, 50), // Reduced padding
      autoPanPaddingTopLeft: L.point(50, 50),
      autoPanPaddingBottomRight: L.point(50, 80), // Reduced bottom padding
      closeOnClick: false, // Don't close when clicking on map
      autoClose: false, // Don't auto-close when opening another popup
    }).setContent(popupContent);
    
    marker.bindPopup(popup).openPopup();
    
    // Remove marker when popup closes
    marker.on("popupclose", () => {
      console.log(`[SEARCH MARKER] 🔴 POPUP CLOSED - Removing search marker`);
      if (mapInstance.current && marker) {
        mapInstance.current.removeLayer(marker);
        searchMarkerRef.current = null;
      }
    });
    
    // Store buttonId in a variable accessible in setTimeout
    const storedButtonId = buttonId;
    
    // Ensure popup is positioned correctly after map animation
    setTimeout(() => {
      if (marker.getPopup() && marker.isPopupOpen()) {
        marker.getPopup()?.update();
      }
      
      // Add click handler for AI button
      const aiButton = document.getElementById(storedButtonId);
      if (aiButton) {
        aiButton.addEventListener('click', () => {
          // Close popup first (this will trigger popupclose event and remove marker)
          marker.closePopup();
          // Then open AI form (handleAskAI will close dashboard)
          handleAskAI(lat, lon);
        });
      }
    }, 200);
    searchMarkerRef.current = marker;
    
    mapInstance.current.setView([lat, lon], 15, {
      animate: true,
      duration: 0.5
    });
    
    // After zooming to location, trigger dashboard by clicking on the map
    // Wait for map animation to complete, then simulate a click at that location
    setTimeout(() => {
      if (mapInstance.current) {
        // Create a click event at the selected location to trigger dashboard
        const clickEvent = {
          latlng: L.latLng(lat, lon),
          target: mapInstance.current
        };
        
        // Trigger the map click handler to show dashboard
        mapInstance.current.fire('click', clickEvent);
      }
    }, 600); // Wait 600ms for map animation to complete
    
    setSearchQuery("");
    setSearchResults([]);
    setShowSuggestions(false);
  }, [mapInstance]);

  // Handle AI ask - show form first
  const handleAskAI = (lat: number, lon: number, marker?: L.Marker | L.CircleMarker) => {
    // Store marker reference if provided (from marker popup)
    if (marker) {
      markerPopupRef.current = marker;
    } else {
      // Clear marker reference if from search (not from marker)
      markerPopupRef.current = null;
    }
    
    // Close dashboard when asking AI
    setShowDashboard(false);
    setDashboardData(null);
    setIsLoadingData(false);
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    
    setSelectedLocation({ lat, lon });
    setShowAIForm(true);
    setHoursPerDay("8"); // Reset to default
  };

  // Submit AI form and call API
  const handleSubmitAIForm = async () => {
    if (!selectedLocation) return;
    
    const hours = parseInt(hoursPerDay);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      setNotification({
        message: "กรุณากรอกจำนวนชั่วโมงที่ถูกต้อง (0-24)",
        type: 'error'
      });
      return;
    }

    setShowAIForm(false);
    setIsLoadingAI(true);
    setShowAIModal(true);
    setAiResponse("");

    try {
      // Step 1: Get hex polygon at this location to get LAeq
      const hexUrl = `/api/geoserver-proxy/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:hex_005_e2f8&outputFormat=application/json&CQL_FILTER=INTERSECTS(geom,POINT(${selectedLocation.lon} ${selectedLocation.lat}))&maxFeatures=1`;
      
      const hexRes = await fetch(hexUrl);
      if (!hexRes.ok) {
        throw new Error("ไม่สามารถดึงข้อมูล hex polygon ได้");
      }

      const hexJson = await hexRes.json();
      
      if (!hexJson.features || hexJson.features.length === 0) {
        setAiResponse("ยังไม่มีข้อมูลระดับเสียงในพื้นที่นี้");
        setIsLoadingAI(false);
        return;
      }

      const hexFeature = hexJson.features[0];
      const laeq = hexFeature.properties?.laeq || hexFeature.properties?.LAeq || null;

      if (!laeq || laeq === 0) {
        setAiResponse("ยังไม่มีข้อมูลระดับเสียงในพื้นที่นี้");
        setIsLoadingAI(false);
        return;
      }

      // Step 2: Use hours from user input
      const hour = hours.toString();

      // Step 3: Call AI API through proxy
      const aiRes = await fetch("/api/ai-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          laeq: laeq.toString(),
          hour: hour,
        }),
      });

      if (!aiRes.ok) {
        const errorData = await aiRes.json().catch(() => ({}));
        throw new Error(errorData.error || `AI API error: ${aiRes.status}`);
      }

      const aiData = await aiRes.json();
      
      // Extract output from response
      const output = aiData.output || aiData.message || "ไม่สามารถรับข้อมูลจาก AI ได้";
      setAiResponse(output);
      
      // Scroll to bottom after first response is set
      setTimeout(() => {
        if (aiModalContentRef.current) {
          aiModalContentRef.current.scrollTo({
            top: aiModalContentRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    } catch (error: any) {
      console.error("Error asking AI:", error);
      setAiResponse(`เกิดข้อผิดพลาด: ${error.message || "ไม่สามารถเชื่อมต่อกับ AI ได้"}`);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Handle follow-up question
  const handleFollowUpQuestion = async () => {
    if (!followUpQuestion.trim()) return;
    
    setIsLoadingFollowUp(true);
    const currentQuestion = followUpQuestion.trim();
    setFollowUpQuestion(""); // Clear input immediately for better UX

    try {
      // Call follow-up AI API through proxy
      const aiRes = await fetch("/api/ai-followup-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
        }),
      });

      if (!aiRes.ok) {
        const errorData = await aiRes.json().catch(() => ({}));
        throw new Error(errorData.error || `AI API error: ${aiRes.status}`);
      }

      const aiData = await aiRes.json();
      
      // Extract output from response
      const output = aiData.output || aiData.message || "ไม่สามารถรับข้อมูลจาก AI ได้";
      
      // Append new response to existing response with separator
      setAiResponse(prev => {
        if (prev) {
          return prev + "\n\n---\n\n" + output;
        }
        return output;
      });
      
      // Scroll to bottom after response is updated
      setTimeout(() => {
        if (aiModalContentRef.current) {
          aiModalContentRef.current.scrollTo({
            top: aiModalContentRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    } catch (error: any) {
      console.error("Error asking follow-up question:", error);
      setNotification({
        message: `เกิดข้อผิดพลาด: ${error.message || "ไม่สามารถเชื่อมต่อกับ AI ได้"}`,
        type: 'error'
      });
    } finally {
      setIsLoadingFollowUp(false);
    }
  };

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.search-container')) {
        setShowSuggestions(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Memoized helper function to get marker color by noise level
  const getMarkerColor = useCallback((noiseLevel: number): string => {
    if (noiseLevel > 70) return "#ef4444"; // Red
    else if (noiseLevel > 50) return "#f97316"; // Orange
    return "#22c55e"; // Green
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-50">
      {/* Notification Toast - Beautiful error/info messages */}
      {notification.type && (
        <div 
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[2000]"
          style={{
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div className={`flex items-center gap-3 px-6 py-4 rounded-lg shadow-2xl border-2 max-w-md backdrop-blur-sm ${
            notification.type === 'error' 
              ? 'bg-red-50/95 border-red-300 text-red-800' 
              : 'bg-blue-50/95 border-blue-300 text-blue-800'
          }`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              notification.type === 'error' 
                ? 'bg-red-100' 
                : 'bg-blue-100'
            }`}>
              <i className={`fa ${
                notification.type === 'error' 
                  ? 'fa-exclamation-circle text-red-600' 
                  : 'fa-info-circle text-blue-600'
              } text-lg`}></i>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification({message: '', type: null})}
              className={`flex-shrink-0 ml-2 text-lg hover:scale-110 transition-transform ${
                notification.type === 'error' 
                  ? 'text-red-600 hover:text-red-800' 
                  : 'text-blue-600 hover:text-blue-800'
              }`}
            >
              <i className="fa fa-times"></i>
            </button>
          </div>
        </div>
      )}

      {/* Map */}
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* Legend - Bottom Left */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-lg shadow-xl p-4 border border-gray-200">
        <h4 className="font-bold text-gray-800 mb-3 text-lg flex items-center gap-2">
          <i className="fa fa-info-circle text-blue-600"></i>
          Noise Level Legend
        </h4>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div
              className="w-5 h-5 rounded"
              style={{ backgroundColor: "#ef4444" }}
            ></div>
            <span className="text-sm font-semibold text-red-600">
              High (70+ dB)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-5 h-5 rounded"
              style={{ backgroundColor: "#f97316" }}
            ></div>
            <span className="text-sm font-semibold text-orange-600">
              Medium (50-69 dB)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-5 h-5 rounded"
              style={{ backgroundColor: "#22c55e" }}
            ></div>
            <span className="text-sm font-semibold text-green-600">
              Low (below 50 dB)
            </span>
          </div>
        </div>
      </div>

      {/* Top Info Bar */}
      <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-xl p-4 border border-gray-200 search-container">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center shadow-md">
            <i className="fa fa-map-marked-alt text-white text-xl"></i>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">
              Noise Monitoring System
            </h1>
            <p className="text-xs text-gray-500">
              Real-time Environmental Monitoring
            </p>
          </div>
        </div>
        
        {/* Search Box */}
        <div className="relative">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <i className="fa fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (searchTimeoutRef.current) {
                      clearTimeout(searchTimeoutRef.current);
                    }
                    if (showSuggestions && searchResults.length > 0) {
                      const firstResult = searchResults[0];
                      handleSelectLocation(
                        parseFloat(firstResult.lat),
                        parseFloat(firstResult.lon),
                        firstResult.thaiName || firstResult.display_name,
                        firstResult.fullAddress,
                        firstResult.addressDetails || firstResult.address
                      );
                    } else {
                      handleSearch(searchQuery, false);
                    }
                  }
                }}
                placeholder="ค้นหาสถานที่... (เช่น กรุงเทพ, สีลม, สยาม)"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={() => {
                if (searchTimeoutRef.current) {
                  clearTimeout(searchTimeoutRef.current);
                }
                handleSearch(searchQuery, false);
              }}
              disabled={isSearching || !searchQuery.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <i className="fa fa-spinner fa-spin"></i>
                  <span>กำลังค้นหา...</span>
                </>
              ) : (
                <>
                  <i className="fa fa-search"></i>
                  <span>ค้นหา</span>
                </>
              )}
            </button>
          </div>
          
          {/* Search Results Dropdown */}
          {showSuggestions && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-[1001]">
              {isSearching && (
                <div className="px-4 py-3 text-center text-gray-500">
                  <i className="fa fa-spinner fa-spin mr-2"></i>
                  กำลังค้นหา...
                </div>
              )}
              {!isSearching && (
                <>
                  <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                    พบ {searchResults.length} รายการ
                  </div>
                  {searchResults.map((result, index) => {
                    const thaiName = result.thaiName || result.display_name?.split(',')[0] || '';
                    const fullAddress = result.fullAddress || '';
                    const displayName = result.display_name || '';
                    
                    // Highlight matching text in search query
                    const highlightMatch = (text: string, query: string) => {
                      if (!query || !text) return text;
                      const regex = new RegExp(`(${query})`, 'gi');
                      const parts = text.split(regex);
                      return parts.map((part, i) => 
                        regex.test(part) ? (
                          <span key={i} className="bg-yellow-200 font-semibold">{part}</span>
                        ) : part
                      );
                    };
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleSelectLocation(
                          parseFloat(result.lat),
                          parseFloat(result.lon),
                          thaiName || displayName,
                          result.fullAddress,
                          result.addressDetails || result.address
                        )}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
                      >
                        <div className="font-medium text-gray-800 flex items-center gap-2">
                          <i className="fa fa-map-marker-alt text-blue-600"></i>
                          <span>{highlightMatch(thaiName, searchQuery)}</span>
                        </div>
                        {fullAddress && (
                          <div className="text-xs text-gray-500 mt-1 ml-6">
                            {fullAddress}
                          </div>
                        )}
                        {!fullAddress && displayName && (
                          <div className="text-xs text-gray-400 mt-1 ml-6 truncate">
                            {displayName}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dashboard Panel */}
      {showDashboard && (
        <div className="absolute top-20 right-4 bottom-4 w-[600px] bg-white rounded-lg shadow-2xl z-[1000] overflow-y-auto border border-gray-200">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <i className="fa fa-chart-bar text-blue-600"></i>
                Noise Dashboard
              </h2>
              <button
                onClick={() => {
                  setShowDashboard(false);
                  setDashboardData(null);
                  setIsLoadingData(false);
                  if (chartInstanceRef.current) {
                    chartInstanceRef.current.destroy();
                    chartInstanceRef.current = null;
                  }
                }}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <i className="fa fa-times text-xl"></i>
              </button>
            </div>

            {/* Dashboard Content - Show LAeq immediately, other stats update when data loads */}
            {dashboardData && (
              <>
            {/* Stats Cards - Show LAeq immediately, other stats show loading or 0 */}
            <div className="space-y-3 mb-6">
              <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <div className="text-xs text-blue-600 mb-1">LAeq (All Time)</div>
                <div className="text-2xl font-bold text-blue-700">
                  {dashboardData.laeq1h.toFixed(1)}
                  <span className="text-sm">dB(A)</span>
                </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                <div className="text-xs text-green-600 mb-1">Total Records</div>
                <div className="text-2xl font-bold text-green-700">
                    {isLoadingData ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Loading...</span>
                </div>
                    ) : (
                      dashboardData.totalRecords
                    )}
              </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-5 rounded-lg border border-orange-200">
                <div className="text-sm text-orange-600 mb-2">Min</div>
                <div className="text-3xl font-bold text-orange-700">
                  {isLoadingData ? '-' : dashboardData.min.toFixed(1)} <span className="text-lg">dB</span>
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 p-5 rounded-lg border border-red-200">
                <div className="text-sm text-red-600 mb-2">Max</div>
                <div className="text-3xl font-bold text-red-700">
                  {isLoadingData ? '-' : dashboardData.max.toFixed(1)} <span className="text-lg">dB</span>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <i className="fa fa-chart-line"></i>
                Noise Level Chart
              </h3>
              {isLoadingData || dashboardData.totalRecords === 0 ? (
                <div className="flex items-center justify-center" style={{ height: "300px" }}>
                  <div className="flex flex-col items-center">
                    <div className="relative w-12 h-12 mb-3">
                      <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                    </div>
                    <p className="text-sm text-gray-500">กำลังโหลดข้อมูลกราฟ...</p>
                  </div>
                </div>
              ) : (
              <div style={{ height: "300px", position: "relative" }}>
                <canvas id="noiseChart"></canvas>
              </div>
              )}
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* AI Form Modal */}
      {showAIForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowAIForm(false);
            setSelectedLocation(null);
            // Reopen marker popup if it was opened from a marker
            if (markerPopupRef.current) {
              setTimeout(() => {
                markerPopupRef.current?.openPopup();
              }, 100);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-purple-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-30 rounded-xl flex items-center justify-center backdrop-blur-sm">
                    <i className="fa fa-robot text-white text-xl"></i>
                  </div>
                  <h2 className="text-white text-xl font-bold">ถาม AI เกี่ยวกับระดับเสียง</h2>
                </div>
                <button
                  onClick={() => {
                    setShowAIForm(false);
                    setSelectedLocation(null);
                    // Reopen marker popup if it was opened from a marker
                    if (markerPopupRef.current) {
                      setTimeout(() => {
                        markerPopupRef.current?.openPopup();
                      }, 100);
                    }
                  }}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition-colors"
                >
                  <i className="fa fa-times text-xl"></i>
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              <div className="mb-6">
                <label className="block text-gray-700 font-medium mb-3 text-lg">
                  คุณอยู่ในพื้นที่นี้เฉลี่ยกี่ชั่วโมงต่อวัน?
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={hoursPerDay}
                    onChange={(e) => setHoursPerDay(e.target.value)}
                    className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none text-lg font-medium"
                    placeholder="8"
                    autoFocus
                  />
                  <span className="text-gray-600 font-medium text-lg">ชั่วโมง/วัน</span>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  กรุณากรอกจำนวนชั่วโมงที่คุณอยู่ในพื้นที่นี้ต่อวัน (0-24 ชั่วโมง)
                </p>
              </div>

              {/* Quick selection buttons */}
              <div className="grid grid-cols-4 gap-2 mb-6">
                {[1, 2, 4, 8].map((h) => (
                  <button
                    key={h}
                    onClick={() => setHoursPerDay(h.toString())}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      hoursPerDay === h.toString()
                        ? 'bg-indigo-600 text-white shadow-lg scale-105'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {h} ชม.
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAIForm(false);
                  setSelectedLocation(null);
                  // Reopen marker popup if it was opened from a marker
                  if (markerPopupRef.current) {
                    setTimeout(() => {
                      if (markerPopupRef.current) {
                        markerPopupRef.current.openPopup();
                        // Force trigger popupopen event to reattach listeners
                        markerPopupRef.current.fire('popupopen');
                      }
                    }, 100);
                  }
                }}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSubmitAIForm}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                <i className="fa fa-paper-plane"></i>
                <span>ส่งคำถาม</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Response Modal */}
      {showAIModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowAIModal(false);
            setAiResponse("");
            setFollowUpQuestion("");
            // Reopen marker popup if it was opened from a marker
            if (markerPopupRef.current) {
              setTimeout(() => {
                markerPopupRef.current?.openPopup();
              }, 100);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-purple-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white bg-opacity-30 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <i className="fa fa-robot text-white text-xl"></i>
                </div>
                <h2 className="text-white text-xl font-bold">คำตอบจาก AI</h2>
              </div>
              <button
                onClick={() => {
                  setShowAIModal(false);
                  setAiResponse("");
                  setFollowUpQuestion("");
                  // Reopen marker popup if it was opened from a marker
                  if (markerPopupRef.current) {
                    setTimeout(() => {
                      if (markerPopupRef.current) {
                        markerPopupRef.current.openPopup();
                        // Force trigger popupopen event to reattach listeners
                        markerPopupRef.current.fire('popupopen');
                      }
                    }, 100);
                  }
                }}
                className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition-colors"
              >
                <i className="fa fa-times text-xl"></i>
              </button>
            </div>

            {/* Modal Content */}
            <div 
              ref={aiModalContentRef}
              className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-gray-50 to-white"
            >
              {isLoadingAI ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-600 font-medium">กำลังถาม AI...</p>
                </div>
              ) : aiResponse ? (
                <div className="prose max-w-none">
                  <div
                    className="text-gray-800 leading-relaxed whitespace-pre-line"
                    style={{
                      fontFamily: "'Inter', 'Segoe UI', sans-serif",
                      fontSize: "15px",
                      lineHeight: "1.8",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: aiResponse
                        .replace(/\n\n---\n\n/g, '<div style="margin: 32px 0; border-top: 3px solid #6366f1; border-bottom: none; border-left: none; border-right: none; box-shadow: 0 1px 0 rgba(99, 102, 241, 0.1);"></div>')
                        .replace(/\n/g, "<br>")
                        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                        .replace(/\*(.*?)\*/g, "<em>$1</em>"),
                    }}
                  />
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <i className="fa fa-info-circle text-4xl mb-4"></i>
                  <p>ไม่พบข้อมูล</p>
                </div>
              )}
            </div>

            {/* Follow-up Question Input */}
            {!isLoadingAI && aiResponse && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={followUpQuestion}
                    onChange={(e) => setFollowUpQuestion(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleFollowUpQuestion();
                      }
                    }}
                    placeholder="ถามเพิ่มเติม..."
                    disabled={isLoadingFollowUp}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleFollowUpQuestion}
                    disabled={isLoadingFollowUp || !followUpQuestion.trim()}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isLoadingFollowUp ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>กำลังส่ง...</span>
                      </>
                    ) : (
                      <>
                        <i className="fa fa-paper-plane"></i>
                        <span>ส่ง</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowAIModal(false);
                  setAiResponse("");
                  setFollowUpQuestion("");
                  // Reopen marker popup if it was opened from a marker
                  if (markerPopupRef.current) {
                    setTimeout(() => {
                      if (markerPopupRef.current) {
                        markerPopupRef.current.openPopup();
                        // Force trigger popupopen event to reattach listeners
                        markerPopupRef.current.fire('popupopen');
                      }
                    }, 100);
                  }
                }}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

