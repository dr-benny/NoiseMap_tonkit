"use client";

import { useRef, useEffect, useState } from "react";
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
  const hexOverlayRef = useRef<L.ImageOverlay | null>(null);
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

        // Update hex layer function
        const updateHexLayer = () => {
          if (hexOverlayRef.current) {
            map.removeLayer(hexOverlayRef.current);
          }

          const bounds = map.getBounds();
          const size = map.getSize();

          const wmsUrl =
            "http://localhost:8080/geoserver/it.geosolutions/wms?" +
            L.Util.getParamString({
              service: "WMS",
              version: "1.1.0",
              request: "GetMap",
              layers: "it.geosolutions:hex_005_e2f8",
              styles: "hex",
              format: "image/png",
              transparent: true,
              srs: "EPSG:4326",
              bbox: bounds.toBBoxString(),
              width: size.x,
              height: size.y,
              tiled: false,
              TILED: false,
            });

          hexOverlayRef.current = L.imageOverlay(wmsUrl, bounds, {
            opacity: 0.9,
            interactive: true,
          }).addTo(map);
        };

        map.on("moveend zoomend", updateHexLayer);
        updateHexLayer();

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
            const wmsUrl = "http://localhost:8080/geoserver/it.geosolutions/wms?";
            const layer = "it.geosolutions:hex_005_e2f8";
            const bbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`;
            const point = map.latLngToContainerPoint(e.latlng);
            const size = map.getSize();
            const bounds = map.getBounds();
            const bboxString = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

            // Fix URL construction - use proper query parameter format
            const getFeatureInfoUrl =
              `${wmsUrl}service=WMS&version=1.1.1&request=GetFeatureInfo` +
              `&layers=${encodeURIComponent(layer)}` +
              `&query_layers=${encodeURIComponent(layer)}` +
              `&info_format=application/json` +
              `&x=${Math.round(point.x)}&y=${Math.round(point.y)}` +
              `&srs=EPSG:4326&width=${size.x}&height=${size.y}&bbox=${encodeURIComponent(bboxString)}`;

            const res = await fetch(getFeatureInfoUrl);
            if (!res.ok) {
              const errorText = await res.text();
              console.error("GetFeatureInfo failed:", res.status, errorText);
              throw new Error(`GetFeatureInfo failed: ${res.status}`);
            }

            let json;
            try {
              const responseText = await res.text();
              
              // Check if response is empty
              if (!responseText || !responseText.trim()) {
                console.error("GetFeatureInfo response is empty");
                setIsLoadingData(false);
                return; // Don't show dashboard if response is empty
              }

              // Check if response is JSON
              const trimmedText = responseText.trim();
              
              // Check if it's an XML error response
              if (trimmedText.startsWith('<?xml') || trimmedText.startsWith('<ServiceExceptionReport')) {
                // Parse XML error to extract error message
                const errorMatch = trimmedText.match(/<ServiceException[^>]*>([^<]+)<\/ServiceException>/i);
                const errorMessage = errorMatch ? errorMatch[1].trim() : 'Unknown GeoServer error';
                console.error("❌ GeoServer Error:", errorMessage);
                console.error("Full XML Response:", trimmedText.substring(0, 500));
                setIsLoadingData(false);
                return; // Don't show dashboard on error
              }
              
              if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
                console.error("GetFeatureInfo response is not JSON:", trimmedText.substring(0, 200));
                setIsLoadingData(false);
                return; // Don't show dashboard on error
              }

              json = JSON.parse(trimmedText);
            } catch (parseError: any) {
              console.error("Failed to parse GetFeatureInfo response:", parseError.message);
              alert(`Failed to parse response: ${parseError.message}`);
              return;
            }

            if (!json.features || json.features.length === 0) {
              console.warn("No hex found at clicked point");
              setIsLoadingData(false);
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
              avg: 0,
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
              
              // Try to parse error message from JSON response
              let errorMessage = `WFS query failed: ${res2.status}`;
              try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error) {
                  errorMessage = errorJson.error;
                }
              } catch (e) {
                // Keep default error message
              }
              
              setIsLoadingData(false);
              setNotification({
                message: errorMessage,
                type: 'error'
              });
              console.error("WFS Error:", errorMessage);
              return;
            }

            const data = await res2.text();
            
            // Check if response is empty or not JSON
            if (!data || !data.trim()) {
              console.error("WFS response is empty");
              alert("No data received from server");
              return;
            }

            // Check if response is JSON (starts with { or [)
            const trimmedData = data.trim();
            if (!trimmedData.startsWith('{') && !trimmedData.startsWith('[')) {
              console.error("WFS response is not JSON. Response:", trimmedData.substring(0, 200));
              alert("Server returned invalid data format. Please check console for details.");
              return;
            }

            let jsonData;
            try {
              jsonData = JSON.parse(trimmedData);
            } catch (parseError: any) {
              console.error("Failed to parse WFS response as JSON:", parseError.message);
              console.error("Response content:", trimmedData.substring(0, 500));
              alert(`Failed to parse response: ${parseError.message}`);
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
                avg: noiseLevels.reduce((a: number, b: number) => a + b, 0) / noiseLevels.length,
              });
            }
          } catch (err: any) {
            console.error("Error:", err);
            alert(`Error: ${err.message}`);
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
        "http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:current_noise&outputFormat=application/json";

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
                </div>
              `;

              marker.bindPopup(popupContent);

              marker.on("popupopen", function () {
                setTimeout(() => {
                  const btn = document.querySelector(
                    `.popup-btn-${feature.properties.id}`
                  );
                  if (btn) {
                    btn.addEventListener("click", () => {
                      fetchMarkerData(feature.properties.id, lat, lng);
                    });
                  }
                }, 100);
              });
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
      
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:noise_spatial_table&outputFormat=application/json&CQL_FILTER=INTERSECTS(coordinate,POINT(${lng} ${lat}))&SORTBY=time+D&maxFeatures=60`;

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
          const hexWmsUrl = "http://localhost:8080/geoserver/it.geosolutions/wms?";
          const hexLayer = "it.geosolutions:hex_005_e2f8";
          const point = { x: 50, y: 50 }; // Approximate point for GetFeatureInfo
          const hexBbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`;
          
          const hexGetFeatureInfoUrl =
            `${hexWmsUrl}service=WMS&version=1.1.1&request=GetFeatureInfo` +
            `&layers=${encodeURIComponent(hexLayer)}` +
            `&query_layers=${encodeURIComponent(hexLayer)}` +
            `&info_format=application/json` +
            `&x=${point.x}&y=${point.y}` +
            `&srs=EPSG:4326&width=101&height=101&bbox=${encodeURIComponent(hexBbox)}`;
          
          const hexRes = await fetch(hexGetFeatureInfoUrl);
          if (hexRes.ok) {
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
          avg: noiseLevels.reduce((a: number, b: number) => a + b, 0) / noiseLevels.length,
        });
      }
    } catch (error) {
      console.error("Error fetching marker data:", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Function to downsample data for smooth visualization
  const downsampleData = (data: number[], labels: string[], maxPoints: number = 100) => {
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
  };

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

  // Search location function - using Nominatim (OpenStreetMap) - 100% free, supports Thai
  const handleSearch = async (query?: string, showSuggestionsOnly: boolean = false) => {
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
  };

  // Handle input change with debounce - wait for user to stop typing
  const handleInputChange = (value: string) => {
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
  };

  // Handle location selection - show detailed address in popup (custom format)
  const handleSelectLocation = (lat: number, lon: number, name: string, fullAddress?: string, addressDetails?: any) => {
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
    
    // Ensure popup is positioned correctly after map animation
    setTimeout(() => {
      if (marker.getPopup() && marker.isPopupOpen()) {
        marker.getPopup()?.update();
      }
    }, 100);
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

  // Helper function to get marker color by noise level
  function getMarkerColor(noiseLevel: number): string {
    if (noiseLevel > 70) return "#ef4444"; // Red
    else if (noiseLevel > 50) return "#f97316"; // Orange
    return "#22c55e"; // Green
  }

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
            <div className="grid grid-cols-2 gap-3 mb-6">
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
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                <div className="text-xs text-orange-600 mb-1">Min</div>
                <div className="text-xl font-bold text-orange-700">
                  {isLoadingData ? '-' : dashboardData.min.toFixed(1)} dB
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg border border-red-200">
                <div className="text-xs text-red-600 mb-1">Max</div>
                <div className="text-xl font-bold text-red-700">
                  {isLoadingData ? '-' : dashboardData.max.toFixed(1)} dB
                </div>
              </div>
            </div>

            {/* Average */}
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200 mb-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-purple-600">Average</div>
                <div className="text-xl font-bold text-purple-700">
                  {isLoadingData ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                      <span>loading...</span>
                    </div>
                  ) : (
                    `${dashboardData.avg.toFixed(1)} dB(A)`
                  )}
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
    </div>
  );
}
