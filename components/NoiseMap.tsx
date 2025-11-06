"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ChartPanel from "./ChartPanel";

// Configure Leaflet to use CDN for marker icons
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

interface NoiseFeature {
  properties: {
    id: number;
    noise_level: number;
    time: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    borderWidth?: number;
    fill?: boolean;
    tension?: number;
  }>;
  coordinates?: [number, number]; // lat, lng
}

export default function NoiseMap() {
  const mapInstance = useRef<L.Map | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [laeq1h, setLaeq1h] = useState<number | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lng: number} | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [laeqResult, setLaeqResult] = useState<any>(null);
  const [isLoadingLAeq, setIsLoadingLAeq] = useState(false);
  
  // Adjust map size when panel opens
  useEffect(() => {
    if (mapInstance.current) {
      setTimeout(() => {
        mapInstance.current?.invalidateSize();
      }, 350);
    }
  }, [showChart]);

  // Function to fetch LAeq 1h from backend
  const fetchLAeq1h = async (lat: number, lng: number) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch('/api/laeq-backend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: today,
          lat: lat,
          lng: lng,
          type: 'L1h'
        })
      });

      const result = await response.json();
      if (result.laeq) {
        setLaeq1h(result.laeq);
      }
    } catch (error) {
      console.error("Error fetching LAeq 1h:", error);
    }
  };

  // Function to fetch LAeq by type
  const fetchLAeqByType = async (type: 'L24h' | 'Lday' | 'Levening' | 'Lnight') => {
    if (!selectedLocation || !selectedDate) {
      alert("Please select a location on the map first");
      return;
    }

    setIsLoadingLAeq(true);
    setLaeqResult(null);

    try {
      const response = await fetch('/api/laeq-backend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          lat: selectedLocation.lat,
          lng: selectedLocation.lng,
          type: type
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      setLaeqResult(result);
      
      // Update chart if panel is open
      if (showChart && chartData) {
        if (result.trendData && result.trendData.length > 0) {
          const trendLabels = result.trendData.map((item: any) => `${item.hour}:00`);
          const trendValues = result.trendData.map((item: any) => item.laeq);
          
          setChartData({
            ...chartData,
            labels: trendLabels,
            datasets: [{
              ...chartData.datasets[0],
              label: `LAeq ${type}`,
              data: trendValues,
            }]
          });
        }
      }

      console.log("✅ LAeq calculated:", result);
    } catch (err: any) {
      console.error("❌ Error calculating LAeq:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsLoadingLAeq(false);
    }
  };

  // Function to fetch detailed data for marker or hex
  const fetchDetailedData = async (lat: number, lng: number) => {
    try {
      setShowChart(true); // Show loading immediately
      
      const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:noise_spatial_table&outputFormat=application/json&CQL_FILTER=INTERSECTS(coordinate,POINT(${lng} ${lat}))&SORTBY=time+D&maxFeatures=30`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const noiseLevels = data.features.map((f: any) => f.properties.noise_level);
        const labels = data.features.map((f: any) => new Date(f.properties.time).toLocaleString());
        
        setChartData({
          labels: labels.reverse(),
          datasets: [{
            label: "Noise Levels (dB)",
            data: noiseLevels.reverse(),
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
          }],
        });
      } else {
        alert("No historical data found for this location.");
        setShowChart(false);
      }
    } catch (error) {
      console.error("Error fetching detailed info:", error);
      alert("Error loading detailed data. Please check GeoServer connection.");
      setShowChart(false);
    }
  };

  useEffect(() => {
    if (!mapInstance.current) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        const map = L.map("map", {
          center: [13.756111, 100.516667],
          zoom: 13,
          zoomControl: true,
        });

        // Invalidate size to ensure map renders properly
        setTimeout(() => {
          map.invalidateSize();
        }, 100);

        const terrainLayer = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            opacity: 0.8,
            minZoom: 5,
            attribution: "© OpenStreetMap contributors",
          }
        );
        terrainLayer.addTo(map);

        const blackOverlay = L.rectangle(
          [[-90, -180], [90, 180]],
          { color: "black", weight: 0, fillColor: "black", fillOpacity: 0.3 }
        );
        blackOverlay.addTo(map);

        let hexOverlay: L.ImageOverlay | null = null;
        
        // Update hex layer
        function updateHexLayer() {
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

          if (hexOverlay) map.removeLayer(hexOverlay);
          hexOverlay = L.imageOverlay(wmsUrl, bounds, { opacity: 0.9, interactive: true }).addTo(map);
        }

        map.on("moveend zoomend", updateHexLayer);
        updateHexLayer();

        // Handle map clicks to get hex data
        map.on("click", async (e) => {
          const lat = e.latlng.lat;
          const lng = e.latlng.lng;
          
          console.log("Clicked at:", lat, lng);
          
          try {
            // GetFeatureInfo to find which hex was clicked
            const wmsUrl = "http://localhost:8080/geoserver/it.geosolutions/wms?";
            const layer = "it.geosolutions:hex_005_e2f8";
            
            // Get current map bounds for proper bbox
            const bounds = map.getBounds();
            const size = map.getSize();
            
            // Calculate pixel coordinates from lat/lng
            const point = map.latLngToContainerPoint(e.latlng);
            const x = Math.round(point.x);
            const y = Math.round(point.y);
            
            // Use current map bounds for bbox
            const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

            // Fix URL construction - use proper query parameter format
            const getFeatureInfoUrl =
              `${wmsUrl}service=WMS&version=1.1.1&request=GetFeatureInfo` +
              `&layers=${encodeURIComponent(layer)}` +
              `&query_layers=${encodeURIComponent(layer)}` +
              `&info_format=application/json` +
              `&x=${x}&y=${y}` +
              `&srs=EPSG:4326&width=${size.x}&height=${size.y}&bbox=${encodeURIComponent(bbox)}`;

            console.log("═══════════════════════════════════════════════════════");
            const clickCount = ((window as any).clickCount = ((window as any).clickCount || 0) + 1);
            console.log("🔍 HEX CLICK DEBUG - Click #" + clickCount);
            console.log("═══════════════════════════════════════════════════════");
            console.log("📍 Click Position:", { lat, lng });
            console.log("🖱️ Pixel Coordinates:", { x, y });
            console.log("🗺️ Map Size:", { width: size.x, height: size.y });
            console.log("📦 Map Bounds:", {
              west: bounds.getWest(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              north: bounds.getNorth()
            });
            console.log("🔗 GetFeatureInfo URL:", getFeatureInfoUrl);

            const res = await fetch(getFeatureInfoUrl);
            console.log("📥 GetFeatureInfo Response Status:", res.status);
            
            if (!res.ok) {
              const errorText = await res.text();
              console.error("❌ GetFeatureInfo Error:", errorText);
              console.warn("No hex found at clicked point");
              return;
            }

            let json;
            try {
              const responseText = await res.text();
              
              // Check if response is empty
              if (!responseText || !responseText.trim()) {
                console.error("GetFeatureInfo response is empty");
                return;
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
                alert(`GeoServer Error: ${errorMessage}\n\nPlease check:\n- Layer name is correct\n- GeoServer is running\n- Layer is accessible`);
                return;
              }
              
              if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
                console.error("GetFeatureInfo response is not JSON:", trimmedText.substring(0, 200));
                alert("Server returned invalid data format. Please check console for details.");
                return;
              }

              json = JSON.parse(trimmedText);
              console.log("📥 GetFeatureInfo Response (FULL):", JSON.stringify(json, null, 2));
            } catch (parseError: any) {
              console.error("❌ Failed to parse GetFeatureInfo response:", parseError.message);
              alert(`Failed to parse response: ${parseError.message}`);
              return;
            }
            
            if (!json.features || json.features.length === 0) {
              console.warn("⚠️ No hex found at clicked point");
              return;
            }
            
            console.log("✅ Found", json.features.length, "hex feature(s)");

            const feature = json.features[0];
            
            // Get hex ID or identifier for debugging
            const hexId = feature.properties?.id || feature.properties?.gid || feature.id || 'unknown';
            console.log("Hex ID:", hexId);
            console.log("Hex feature:", feature);
            console.log("Hex properties:", feature.properties);
            
            // Check if coordinates are in correct format [lng, lat]
            const coords = feature.geometry.coordinates[0];
            console.log("Raw coordinates sample:", coords.slice(0, 3));
            
            // Ensure coordinates are in "lng lat lng lat ..." format for GML
            const coordsList = coords
              .map((c: number[]) => {
                // GeoJSON is [lng, lat] format
                return `${c[0]} ${c[1]}`;
              })
              .join(" ");

            console.log("🆔 Hex ID:", hexId);
            console.log("📋 Hex Properties:", JSON.stringify(feature.properties, null, 2));
            console.log("📐 Total Coordinates:", coords.length);
            console.log("📐 Coordinates Sample (first 3):", coords.slice(0, 3));
            console.log("📐 Coordinates List (first 100 chars):", coordsList.substring(0, 100));
            console.log("📐 Coordinates List (last 100 chars):", coordsList.substring(Math.max(0, coordsList.length - 100)));

            // Query noise data for this hex using WFS
            const wfsUrl = "/api/wfs-proxy";
            
            // Build WFS XML request
            const wfsXml = `
<wfs:GetFeature service="WFS" version="1.1.0" maxFeatures="1000" outputFormat="application/json" xmlns:wfs="http://www.opengis.net/wfs"
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
</wfs:GetFeature>
`;

            console.log("📤 WFS Request URL:", wfsUrl);
            console.log("📤 WFS XML Request (FULL):");
            console.log(wfsXml);
            console.log("📤 WFS XML Length:", wfsXml.length, "characters");
            
            // Mock WFS response for now - TODO: Replace with actual WFS call
            console.log("📤 Mock WFS Request (would send to:", wfsUrl);
            console.log("📤 WFS XML (first 300 chars):", wfsXml.substring(0, 300));
            
            // Mock response with sample data
            const mockResponse = {
              type: "FeatureCollection",
              features: Array.from({ length: 60 }, (_, i) => ({
                type: "Feature",
                properties: {
                  noise_level: 55 + Math.random() * 20, // 55-75 dB
                  time: new Date(Date.now() - (60 - i) * 60000).toISOString(),
                },
                geometry: {
                  type: "Point",
                  coordinates: [lng, lat],
                },
              })),
            };
            
            console.log("📥 Mock WFS Response: 200 OK");
            console.log("📥 Mock Features Count:", mockResponse.features.length);
            
            // Use mock data directly
            const jsonData = mockResponse;
            
            /*
            // TODO: Uncomment when ready to use actual WFS
            const res2 = await fetch(wfsUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "text/xml; charset=utf-8",
                "Accept": "application/json"
              },
              body: wfsXml.trim(),
            });
            
            console.log("📥 WFS Response Status:", res2.status, res2.statusText);

            if (!res2.ok) {
              const errorText = await res2.text();
              console.error("❌ WFS Error Response:", errorText);
              throw new Error(`WFS query failed: ${res2.status}`);
            }

            const data = await res2.text();
            console.log("📥 WFS Raw Response (FULL):");
            console.log(data);
            
            let jsonData;
            try {
              if (data.trim().startsWith('{')) {
                jsonData = JSON.parse(data);
                console.log("✅ Successfully parsed as JSON");
              } else {
                console.warn("⚠️ WFS returned XML instead of JSON");
                throw new Error("WFS returned XML instead of JSON");
              }
            } catch (parseErr) {
              console.error("❌ Failed to parse WFS response");
              throw parseErr;
            }
            */
            
            console.log("📊 Mock Response Type:", typeof jsonData);
            console.log("📊 Mock Features Count:", jsonData.features?.length || 0);
            
            // Log all features details
            if (jsonData.features && jsonData.features.length > 0) {
              console.log("📊 All Features Data:");
              jsonData.features.forEach((f: any, idx: number) => {
                console.log(`  Feature #${idx + 1}:`, {
                  id: f.id,
                  noise_level: f.properties?.noise_level,
                  time: f.properties?.time,
                  coordinate: f.properties?.coordinate,
                  geometry: f.geometry?.type
                });
              });
              
              console.log("📊 First Feature (Full):", JSON.stringify(jsonData.features[0], null, 2));
              console.log("📊 Last Feature (Full):", JSON.stringify(jsonData.features[jsonData.features.length - 1], null, 2));
              
              // Extract unique noise levels
              const uniqueLevels = [...new Set(jsonData.features.map((f: any) => f.properties?.noise_level))];
              console.log("📊 Unique Noise Levels:", uniqueLevels);
              console.log("📊 Noise Levels Range:", {
                min: Math.min(...jsonData.features.map((f: any) => f.properties?.noise_level || 0)),
                max: Math.max(...jsonData.features.map((f: any) => f.properties?.noise_level || 0)),
                avg: jsonData.features.reduce((sum: number, f: any) => sum + (f.properties?.noise_level || 0), 0) / jsonData.features.length
              });
            } else {
              console.warn("⚠️ No features found in response");
            }
            
            console.log("═══════════════════════════════════════════════════════");
            
            if (jsonData.features && jsonData.features.length > 0) {
              const noiseLevels = jsonData.features.map((f: any) => f.properties.noise_level);
              const labels = jsonData.features.map((f: any) => new Date(f.properties.time).toLocaleString());
              
              // Generate unique color based on hex location
              const colorHash = (hexId: string) => {
                let hash = 0;
                for (let i = 0; i < hexId.length; i++) {
                  hash = hexId.charCodeAt(i) + ((hash << 5) - hash);
                }
                const hue = Math.abs(hash % 360);
                return `hsl(${hue}, 70%, 50%)`;
              };
              
              const hexColor = colorHash(hexId);
              
              // Create new chart data object to force re-render
              const newChartData = {
                labels: labels.reverse(),
                datasets: [{
                  label: `Noise Levels - Hex ${hexId.substring(hexId.length - 10)}`,
                  data: noiseLevels.reverse(),
                  borderColor: hexColor,
                  backgroundColor: hexColor.replace(')', ', 0.2)').replace('hsl', 'hsla'),
                  borderWidth: 3,
                  fill: true,
                  tension: 0.4,
                }],
              };
              
              console.log("📈 Setting new chart data:", {
                labelsCount: newChartData.labels.length,
                dataCount: newChartData.datasets[0].data.length,
                color: hexColor,
                hexId: hexId.substring(hexId.length - 10)
              });
              
              // Auto-fetch LAeq 1h when hex is clicked
              await fetchLAeq1h(lat, lng);
              
              // Clear old chart data first
              setChartData(null);
              
              // Set new data after a tiny delay to force re-render
              setTimeout(() => {
                setChartData(newChartData);
                setShowChart(true);
              }, 10);
            } else {
              alert("No noise data found in this hex polygon.");
            }
          } catch (err) {
            console.error("Error fetching hex data:", err);
            alert("Error loading hex data. Check console for details.");
          }
        });

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

        const baseLayers = { Terrain: terrainLayer, Satellite: satelliteLayer };
        (L.control as any).layers(baseLayers).addTo(map);

        const legend = (L.control as any)({ position: "bottomleft" });
        legend.onAdd = function () {
          const div = L.DomUtil.create("div", "legend");
          div.innerHTML = `
            <div class="p-4 bg-white rounded-lg shadow-xl border border-gray-200">
              <h4 class="font-bold mb-3 text-gray-800 text-lg">Noise Level Legend</h4>
              <div class="flex items-center mb-2 py-1">
                <span class="w-5 h-5 rounded me-3 bg-red-500 inline-block shadow-md"></span>
                <span class="text-red-600 font-bold">High (70+ dB)</span>
              </div>
              <div class="flex items-center mb-2 py-1">
                <span class="w-5 h-5 rounded me-3 bg-orange-500 inline-block shadow-md"></span>
                <span class="text-orange-600 font-bold">Medium (50-69 dB)</span>
              </div>
              <div class="flex items-center py-1">
                <span class="w-5 h-5 rounded me-3 bg-green-500 inline-block shadow-md"></span>
                <span class="text-green-600 font-bold">Low (below 50 dB)</span>
              </div>
            </div>
          `;
          return div;
        };
        legend.addTo(map);

        const markers = L.layerGroup().addTo(map);

        fetch(
          "http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:current_noise&outputFormat=application/json"
        )
          .then((res) => res.json())
          .then((data: { features: NoiseFeature[] }) => {
            if (data.features) {
              data.features.forEach((feature) => {
                const color = getMarkerColor(feature.properties.noise_level);
                
                const marker = L.circleMarker(
                  [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
                  {
                    radius: 12,
                    fillColor: color,
                    color: "#fff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9,
                  }
                );

                const time = new Date(feature.properties.time).toLocaleString();
                const popupContent = `
                  <div class="p-4 w-80">
                    <div class="text-lg font-bold mb-3 text-gray-800">
                      <i class="fa fa-microphone-alt text-blue-600 mr-2"></i>
                      ID:1 | TonkitLab
                    </div>
                    <div class="flex items-center mb-3">
                      <i class="fa fa-battery-full text-green-500 mr-2"></i>
                      <span class="text-sm font-semibold">Battery: 100%</span>
                    </div>
                    <div class="mb-2 p-2 bg-blue-50 rounded-lg">
                      <span class="font-bold text-gray-700">Noise Level:</span> 
                      <span class="text-xl font-bold text-blue-600 ml-2">${feature.properties.noise_level} dB(A)</span>
                    </div>
                    <p class="mb-4 text-sm text-gray-600">
                      <i class="fa fa-clock mr-1"></i>
                      <span class="font-bold">Time:</span> ${time}
                    </p>
                    <button 
                      id="btn-${feature.properties.id}"
                      class="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                      View Details <i class="fa-solid fa-arrow-right ml-2"></i>
                    </button>
                  </div>
                `;

                marker.bindPopup(popupContent);
                
                // Store coordinates in marker for later use
                (marker as any).coordinates = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];

                // Add click handler for View Details button
                marker.on("popupopen", () => {
                  setTimeout(() => {
                    const btn = document.getElementById(`btn-${feature.properties.id}`);
                    if (btn) {
                      btn.addEventListener("click", () => {
                        const coords = (marker as any).coordinates;
                        if (coords && coords.length === 2) {
                          fetchDetailedData(coords[0], coords[1]);
                          fetchLAeq1h(coords[0], coords[1]);
                        }
                      });
                    }
                  }, 100);
                });
                
                // Set selected location and fetch LAeq 1h when marker is clicked
                marker.on("click", () => {
                  const coords = (marker as any).coordinates;
                  if (coords && coords.length === 2) {
                    setSelectedLocation({ lat: coords[0], lng: coords[1] });
                    fetchLAeq1h(coords[0], coords[1]);
                  }
                });

                markers.addLayer(marker);
              });
            }
          })
          .catch((error) => {
            console.error("Error fetching noise data:", error);
          });

        mapInstance.current = map;
      }, 100);

      return () => {
        clearTimeout(timer);
        if (mapInstance.current) {
          mapInstance.current.remove();
        }
      };
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
      }
    };
  }, []);

  return (
    <>
      <div className="relative w-screen h-screen overflow-hidden">
        <div id="map" style={{ width: '100%', height: '100%' }} />
        <div className="absolute top-0 left-0 right-0 z-[1000] bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 text-white shadow-xl">
          <div className="container mx-auto p-4">
            {/* Top Row: Title and LAeq 1h */}
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <i className="fa fa-map-marked-alt text-3xl"></i>
                <div>
                  <div>Noise Monitoring</div>
                  <div className="text-sm font-normal opacity-90">Real-time System</div>
                </div>
              </h1>
              <div className="flex items-center gap-4">
                {laeq1h !== null && (
                  <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/30 shadow-lg">
                    <div className="text-xs opacity-90 mb-1 flex items-center gap-1">
                      <i className="fa fa-microphone"></i>
                      LAeq 1h (Latest)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{laeq1h.toFixed(1)}</span>
                      <span className="text-sm">dB(A)</span>
                    </div>
                  </div>
                )}
                <div className="hidden md:flex items-center gap-2 text-sm bg-white/10 px-4 py-2 rounded-full backdrop-blur-sm">
                  <i className="fa fa-satellite"></i>
                  <span>TonkitLab</span>
                </div>
              </div>
            </div>
            
            {/* Bottom Row: Date Selector and LAeq Buttons */}
            {selectedLocation && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg">
                  <i className="fa fa-calendar-alt text-sm"></i>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-transparent border-none text-white text-sm focus:outline-none focus:ring-0 cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchLAeqByType('L24h')}
                    disabled={isLoadingLAeq}
                    className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingLAeq ? (
                      <i className="fa fa-spinner fa-spin"></i>
                    ) : (
                      <i className="fa fa-chart-line"></i>
                    )}
                    <span className="text-sm">LAeq 24h</span>
                  </button>
                  
                  <button
                    onClick={() => fetchLAeqByType('Lday')}
                    disabled={isLoadingLAeq}
                    className="px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingLAeq ? (
                      <i className="fa fa-spinner fa-spin"></i>
                    ) : (
                      <i className="fa fa-sun"></i>
                    )}
                    <span className="text-sm">Lday</span>
                  </button>
                  
                  <button
                    onClick={() => fetchLAeqByType('Levening')}
                    disabled={isLoadingLAeq}
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingLAeq ? (
                      <i className="fa fa-spinner fa-spin"></i>
                    ) : (
                      <i className="fa fa-moon"></i>
                    )}
                    <span className="text-sm">Levening</span>
                  </button>
                  
                  <button
                    onClick={() => fetchLAeqByType('Lnight')}
                    disabled={isLoadingLAeq}
                    className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingLAeq ? (
                      <i className="fa fa-spinner fa-spin"></i>
                    ) : (
                      <i className="fa fa-moon"></i>
                    )}
                    <span className="text-sm">Lnight</span>
                  </button>
                </div>
                
                {/* LAeq Result Display */}
                {laeqResult && (
                  <div className="ml-auto bg-white/20 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/30 shadow-lg">
                    <div className="text-xs opacity-90 mb-1">LAeq {laeqResult.type}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{laeqResult.laeq?.toFixed(1) || '0.0'}</span>
                      <span className="text-sm">dB(A)</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showChart && chartData && (
        <ChartPanel
          key={`chart-${chartData.datasets[0]?.label || Date.now()}`}
          isOpen={showChart}
          data={chartData}
          coordinates={chartData.coordinates || undefined}
          laeqResult={laeqResult}
          onClose={() => {
            setShowChart(false);
            setChartData(null);
            setLaeqResult(null);
          }}
        />
      )}
    </>
  );
}

function getMarkerColor(noiseLevel: number): string {
  if (noiseLevel > 70) return "#ef4444";
  if (noiseLevel > 50) return "#f97316";
  return "#22c55e";
}
