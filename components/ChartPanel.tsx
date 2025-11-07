"use client";

import { useRef, useEffect, useState, memo } from "react";

interface ChartPanelProps {
  isOpen: boolean;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
    }>;
    laeq1h?: number;
  };
  onClose: () => void;
  locationId?: string;
  noiseLevel?: number;
  coordinates?: [number, number]; // lat, lng for fetching more data
  laeqResult?: any; // LAeq result from header buttons
}

type LaeqType = 'Laeq1h' | 'Laeq24h' | 'Lday' | 'Levening' | 'Lnight';

function ChartPanel({ isOpen, data, onClose, locationId, noiseLevel, coordinates, laeqResult: propLaeqResult }: ChartPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [filteredData, setFilteredData] = useState(data);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLaeqType, setSelectedLaeqType] = useState<LaeqType>('Laeq1h');
  const [allData, setAllData] = useState<{labels: string[], data: number[], laeq1h?: number} | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [laeqResult, setLaeqResult] = useState<{
    laeq: number;
    totalRecords: number;
    trendData: Array<{hour: number, laeq: number, count: number}>;
    min?: number;
    max?: number;
    avg?: number;
    type?: string;
  } | null>(propLaeqResult || null);
  
  // Update when prop changes
  useEffect(() => {
    if (propLaeqResult) {
      setLaeqResult(propLaeqResult);
    }
  }, [propLaeqResult]);
  
  // Function to calculate LAeq from noise level array
  const calculateLAeq = (laeq1minArray: number[]): number => {
    if (laeq1minArray.length === 0) return 0;
    
    const sum = laeq1minArray.reduce(
      (acc, val) => acc + Math.pow(10, val / 10),
      0
    );
    
    const laeq = 10 * Math.log10(sum / laeq1minArray.length);
    return parseFloat(laeq.toFixed(1));
  };
  
  // Calculate different Laeq types based on time period
  const calculateLaeqByType = (type: LaeqType, allData: number[], allLabels: string[]): number => {
    if (allData.length === 0 || allLabels.length === 0) return 0;
    
    let filteredData: number[] = [];
    
    switch (type) {
      case 'Laeq1h':
        // Use last 60 minutes (1 hour)
        filteredData = allData.slice(0, Math.min(60, allData.length));
        break;
        
      case 'Laeq24h':
        // Use all available data (up to 24 hours)
        filteredData = allData;
        break;
        
      case 'Lday':
        // Daytime: 06:00 - 18:00
        filteredData = allData.filter((_, idx) => {
          const hour = new Date(allLabels[idx]).getHours();
          return hour >= 6 && hour < 18;
        });
        break;
        
      case 'Levening':
        // Evening: 18:00 - 22:00
        filteredData = allData.filter((_, idx) => {
          const hour = new Date(allLabels[idx]).getHours();
          return hour >= 18 && hour < 22;
        });
        break;
        
      case 'Lnight':
        // Night: 22:00 - 06:00
        filteredData = allData.filter((_, idx) => {
          const hour = new Date(allLabels[idx]).getHours();
          return hour >= 22 || hour < 6;
        });
        break;
    }
    
    if (filteredData.length === 0) return 0;
    return calculateLAeq(filteredData);
  };
  
  // Function to downsample data for visualization
  const downsampleData = (dataPoints: number[], labels: string[], maxPoints: number = 100) => {
    if (dataPoints.length <= maxPoints) {
      return { data: dataPoints, labels: labels };
    }
    
    const step = Math.ceil(dataPoints.length / maxPoints);
    const downsampledData: number[] = [];
    const downsampledLabels: string[] = [];
    
    for (let i = 0; i < dataPoints.length; i += step) {
      // Take average of points in this step
      const chunk = dataPoints.slice(i, Math.min(i + step, dataPoints.length));
      const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
      downsampledData.push(avg);
      downsampledLabels.push(labels[i]);
    }
    
    // Always include last point
    if (downsampledLabels[downsampledLabels.length - 1] !== labels[labels.length - 1]) {
      downsampledData.push(dataPoints[dataPoints.length - 1]);
      downsampledLabels.push(labels[labels.length - 1]);
    }
    
    return { data: downsampledData, labels: downsampledLabels };
  };
  
  // Get data source based on selected type
  const getDataForType = () => {
    // Always use allData if available (it contains filtered data from date range)
    if (allData && allData.data.length > 0) {
      return {
        data: allData.data,
        labels: allData.labels
      };
    }
    
    // Otherwise use filtered data
    return {
      data: filteredData.datasets[0]?.data || data.datasets[0]?.data || [],
      labels: filteredData.labels.length > 0 ? filteredData.labels : data.labels
    };
  };
  
  // Calculate current Laeq value based on selected type
  const currentLaeq = (() => {
    // Use cached LAeq1h from allData if available and selected
    if (selectedLaeqType === 'Laeq1h') {
      if (allData && allData.laeq1h !== undefined) {
        return allData.laeq1h;
      }
      if (data.laeq1h) {
        return data.laeq1h;
      }
    }
    
    const source = getDataForType();
    if (source.data.length === 0) return 0;
    return calculateLaeqByType(selectedLaeqType, source.data, source.labels);
  })();
  
  // Get chart data (downsampled if needed)
  const getChartDisplayData = () => {
    const source = getDataForType();
    
    // Downsample if data is too large for visualization
    if (source.data.length > 100) {
      const downsampled = downsampleData(source.data, source.labels, 100);
      return {
        data: downsampled.data,
        labels: downsampled.labels
      };
    }
    
    return source;
  };

  // Generate unique colors based on location or noise level
  const getChartColors = () => {
    const avgNoise = noiseLevel || (filteredData.datasets[0]?.data.length > 0 
      ? filteredData.datasets[0].data.reduce((a, b) => a + b, 0) / filteredData.datasets[0].data.length 
      : 50);
    
    if (avgNoise > 70) {
      return {
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        pointColor: "rgb(239, 68, 68)",
        fillColor: "rgba(239, 68, 68, 0.2)"
      };
    } else if (avgNoise > 50) {
      return {
        borderColor: "rgb(249, 115, 22)",
        backgroundColor: "rgba(249, 115, 22, 0.1)",
        pointColor: "rgb(249, 115, 22)",
        fillColor: "rgba(249, 115, 22, 0.2)"
      };
    } else {
      return {
        borderColor: "rgb(34, 197, 94)",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        pointColor: "rgb(34, 197, 94)",
        fillColor: "rgba(34, 197, 94, 0.2)"
      };
    }
  };

  // Reset and update when data changes (new hex clicked)
  useEffect(() => {
    if (data.labels.length > 0) {
      const dates = data.labels.map(label => new Date(label).getTime());
      const minDate = new Date(Math.min(...dates));
      
      // Set selected date to the latest date in data
      const newDate = minDate.toISOString().slice(0, 10); // YYYY-MM-DD
      
      setSelectedDate(newDate);
      setFilteredData(data); // Update filtered data immediately
      
      // Store all data for reference
      setAllData({
        labels: data.labels,
        data: data.datasets[0]?.data || [],
        laeq1h: data.laeq1h
      });
      
      console.log("🔄 ChartPanel: Data updated, resetting date");
      console.log("📊 New data labels count:", data.labels.length);
      console.log("📊 Selected date:", newDate);
    }
  }, [data]);
  
  // Fetch more data when Laeq type requires more than 1 hour
  useEffect(() => {
    if (!isOpen || !coordinates || selectedLaeqType === 'Laeq1h') return;
    
    // Only fetch if we need more data (24h, Lday, etc.)
    if (selectedLaeqType === 'Laeq24h' || selectedLaeqType === 'Lday' || selectedLaeqType === 'Levening' || selectedLaeqType === 'Lnight') {
      setIsFetchingMore(true);
      
      // Fetch 1440 records (24 hours = 1440 minutes)
      // Use API proxy instead of direct GeoServer URL
      const wfsRequest = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature service="WFS" version="1.0.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml">
  <wfs:Query typeName="it.geosolutions:noise_spatial_table">
    <ogc:Filter>
      <ogc:Intersects>
        <ogc:PropertyName>coordinate</ogc:PropertyName>
        <gml:Point>
          <gml:coordinates>${coordinates[1]},${coordinates[0]}</gml:coordinates>
        </gml:Point>
      </ogc:Intersects>
    </ogc:Filter>
  </wfs:Query>
</wfs:GetFeature>`;
      
      fetch('/api/wfs-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
        },
        body: wfsRequest,
      })
        .then(res => res.json())
        .then(responseData => {
          if (responseData.features && responseData.features.length > 0) {
            const noiseLevels = responseData.features.map((f: any) => f.properties.noise_level);
            const labels = responseData.features.map((f: any) => new Date(f.properties.time).toLocaleString());
            
            setAllData({
              labels: labels.reverse(),
              data: noiseLevels.reverse()
            });
            
            console.log("📥 Fetched extended data:", responseData.features.length, "records");
          }
          setIsFetchingMore(false);
        })
        .catch(err => {
          console.error("Error fetching extended data:", err);
          setIsFetchingMore(false);
        });
    }
  }, [selectedLaeqType, isOpen, coordinates]);

  // Function to fetch LAeq from backend API - ทำงานอัตโนมัติเมื่อกดปุ่ม
  const fetchLAeq = async (type: '24h' | 'day' | 'evening' | 'night') => {
    if (!coordinates || !selectedDate) {
      alert("Please select a date first");
      return;
    }

    setIsLoading(true);
    setIsFiltering(true);
    setLaeqResult(null); // Clear previous result

    try {
      const response = await fetch('/api/laeq-backend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          lat: coordinates[0],
          lng: coordinates[1],
          type: type === '24h' ? 'L24h' : type === 'day' ? 'Lday' : type === 'evening' ? 'Levening' : 'Lnight'
        })
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      // Set result with min, max, avg
      setLaeqResult({
        laeq: result.laeq,
        totalRecords: result.totalRecords,
        trendData: result.trendData || [],
        min: result.min,
        max: result.max,
        avg: result.avg,
      });

      // Update chart data automatically
      if (result.trendData && result.trendData.length > 0) {
        // L24h: แสดง hourly trend
        const trendLabels = result.trendData.map((item: any) => `${item.hour}:00`);
        const trendValues = result.trendData.map((item: any) => item.laeq);
        
        setFilteredData({
          labels: trendLabels,
          datasets: [{
            label: `LAeq ${type === '24h' ? '24h' : type === 'day' ? 'Lday' : type === 'evening' ? 'Levening' : 'Lnight'}`,
            data: trendValues,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
          }]
        });
      } else {
        // For non-24h types: แสดงแค่ค่าเดียว
        setFilteredData({
          labels: [`${type === 'day' ? 'Lday' : type === 'evening' ? 'Levening' : 'Lnight'}`],
          datasets: [{
            label: `LAeq ${type === 'day' ? 'Lday' : type === 'evening' ? 'Levening' : 'Lnight'}`,
            data: [result.laeq],
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
          }]
        });
      }

      console.log("✅ LAeq calculated:", result);
    } catch (err: any) {
      console.error("❌ Error calculating LAeq:", err);
      alert(`Error: ${err.message}`);
      setLaeqResult(null);
    } finally {
      setIsLoading(false);
      setIsFiltering(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      return;
    }

    if (isLoading || !canvasRef.current || filteredData.labels.length === 0) return;

    // Destroy old chart instance when data changes
    if (chartInstanceRef.current) {
      console.log("🗑️ Destroying old chart instance before creating new one");
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    // Small delay to ensure canvas is mounted
    const timeout = setTimeout(() => {
      if (!canvasRef.current) return;

      // Double check before creating
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      
      console.log("📊 Creating new chart with data:", {
        labels: filteredData.labels.length,
        dataPoints: filteredData.datasets[0]?.data.length
      });

      import("chart.js/auto").then((ChartModule) => {
        if (!canvasRef.current) return;
        
        const Chart = ChartModule.Chart;
        const colors = getChartColors();
        const thresholdValue = 50;
        
        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, colors.fillColor);
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        // Get display data (downsampled if needed for better visualization)
        const displayData = getChartDisplayData();
        
        const aboveThresholdCount = displayData.data.filter(
          (value) => value > thresholdValue
        ).length;
        const shouldHidePoints = displayData.data.length > 50;
        
        // Store labels for tick callback (closure)
        const displayLabels = displayData.labels;
        
        // Recalculate point colors and radii for display data
        const displayPointColors = displayData.data.map((value: number) =>
          value > thresholdValue ? "rgb(239, 68, 68)" : colors.pointColor
        );
        const displayPointRadii = displayData.data.map((value: number) =>
          value > thresholdValue ? 5 : 3
        );
        
        chartInstanceRef.current = new Chart(ctx, {
          type: "line",
          data: {
            labels: displayLabels,
            datasets: [{
              label: filteredData.datasets[0]?.label || "Noise Level (dB)",
              data: displayData.data,
              borderColor: colors.borderColor,
              backgroundColor: gradient,
              pointBackgroundColor: shouldHidePoints ? 'transparent' : displayPointColors,
              pointBorderColor: "#fff",
              pointRadius: shouldHidePoints ? 0 : displayPointRadii,
              pointHoverRadius: shouldHidePoints ? 0 : 6,
              borderWidth: 3,
              fill: true,
              tension: 0.6, // เพิ่ม tension ให้ smooth มากขึ้น
              pointStyle: "circle",
            }],
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
              title: {
                display: true,
                text: locationId ? `Noise History - ${locationId}` : "Noise History",
                font: { 
                  size: 16,
                  weight: "bold"
                },
                color: "#1f2937",
                padding: {
                  top: 10,
                  bottom: 20
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
                borderColor: colors.borderColor,
                borderWidth: 2,
                displayColors: true,
                cornerRadius: 8,
                boxPadding: 6,
                callbacks: {
                  label: function(context: any) {
                    return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)} dB(A)`;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: false,
                min: Math.max(0, Math.min(...displayData.data) - 15),
                max: Math.min(100, Math.max(...displayData.data) + 15),
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
                }
              },
              x: {
                offset: false, // ไม่มี offset เพื่อให้กราฟเต็มพื้นที่
                bounds: 'data', // ใช้ข้อมูลเต็มพื้นที่
                title: {
                  display: false,
                },
                grid: {
                  color: "rgba(0, 0, 0, 0.06)",
                  lineWidth: 1,
                },
                afterBuildTicks: function(axis: any) {
                  const totalLabels = displayLabels.length;
                  if (totalLabels === 0) return;
                  
                  // คำนวณ index ที่ต้องการแสดง (4 จุด: เริ่ม, 1/3, 2/3, สุดท้าย)
                  const targetIndices = [
                    0,
                    Math.floor(totalLabels / 3),
                    Math.floor(totalLabels * 2 / 3),
                    totalLabels - 1
                  ];
                  
                  // สร้าง ticks ใหม่เฉพาะ 4 จุดที่ต้องการ
                  const newTicks: any[] = [];
                  targetIndices.forEach((labelIndex) => {
                    if (labelIndex < totalLabels) {
                      newTicks.push({
                        value: labelIndex,
                        label: displayLabels[labelIndex]
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
                      const date = new Date(tick.label);
                      // แสดงทั้งวันที่และเวลา รวมปีด้วย และขึ้นบรรทัดใหม่
                      const dateStr = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      });
                      const timeStr = date.toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      });
                      // ใช้ array ของ strings เพื่อให้ Chart.js render เป็น multiline
                      return [dateStr, timeStr];
                    } catch {
                      return '';
                    }
                  }
                }
              },
            },
          },
        });

        // Add threshold count text
        if (ctx && aboveThresholdCount > 0) {
          const chart = chartInstanceRef.current;
          const originalDraw = chart.draw.bind(chart);
          chart.draw = function() {
            originalDraw();
            ctx.save();
            ctx.font = "bold 11px sans-serif";
            ctx.fillStyle = "rgb(239, 68, 68)";
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.fillText(
              `Above threshold: ${aboveThresholdCount} points`,
              chart.chartArea.right,
              chart.chartArea.top + 5
            );
            ctx.restore();
          };
        }
      });
    }, 100);

    return () => {
      clearTimeout(timeout);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [isOpen, filteredData, isLoading, locationId, noiseLevel, selectedLaeqType, allData]);

  const downloadCSV = () => {
    const csv = [
      "Time,Noise Level (dB)",
      ...filteredData.labels.map((label, i) => `"${label}",${filteredData.datasets[0].data[i]}`)
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "noise-data.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadChart = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "noise-chart.png";
    a.click();
  };

  if (!isOpen) return null;

  const avgNoise = filteredData.datasets[0]?.data.length > 0
    ? (filteredData.datasets[0].data.reduce((a, b) => a + b, 0) / filteredData.datasets[0].data.length).toFixed(1)
    : "N/A";

  // Simple inline chart rendering (for sidebar embedding)
  if (!isOpen) {
    return (
      <div className="w-full h-full">
        {filteredData.labels.length > 0 ? (
          <canvas ref={canvasRef} className="w-full h-full"></canvas>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No chart data available
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[2000] w-[450px] bg-white shadow-2xl overflow-y-auto border-l border-gray-200">
      {/* Header */}
      <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 shadow-lg z-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <i className="fa fa-chart-line"></i>
            Noise History
          </h2>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition-colors text-xl"
          >
            <i className="fa fa-times"></i>
          </button>
        </div>
        
        {/* LAeq Display with Type Selector */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 mb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <label className="text-xs opacity-90 mb-1 block">LAeq Type</label>
              <div className="flex gap-1 flex-wrap">
                {(['Laeq1h', 'Laeq24h', 'Lday', 'Levening', 'Lnight'] as LaeqType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedLaeqType(type)}
                    disabled={isFetchingMore}
                    className={`px-2 py-1 text-xs rounded transition-all ${
                      selectedLaeqType === type
                        ? 'bg-white text-blue-700 font-bold shadow-md'
                        : 'bg-white/20 hover:bg-white/30'
                    } ${isFetchingMore ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {type === 'Laeq1h' ? '1h' : type === 'Laeq24h' ? '24h' : type === 'Levening' ? 'Evening' : type}
                  </button>
                ))}
              </div>
              {isFetchingMore && (
                <div className="text-xs mt-1 opacity-75 flex items-center gap-1">
                  <i className="fa fa-spinner fa-spin"></i>
                  Loading extended data...
                </div>
              )}
            </div>
            <div className="text-right min-w-[100px]">
              <div className="text-xs opacity-90 mb-1">
                LAeq {selectedLaeqType === 'Laeq1h' ? '1h' : selectedLaeqType === 'Laeq24h' ? '24h' : selectedLaeqType}
              </div>
              <div className="text-2xl font-bold flex items-center justify-end gap-1">
                <i className="fa fa-microphone"></i>
                {currentLaeq.toFixed(1)}
                <span className="text-sm">dB(A)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* LAeq Result Display - แสดงผลลัพธ์จาก header buttons */}
        {laeqResult && (
          <div className="mb-4 p-4 bg-gradient-to-br from-blue-50 via-blue-100 to-indigo-50 rounded-lg border-2 border-blue-200 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <i className="fa fa-chart-bar text-blue-600 text-xl"></i>
                <h3 className="text-lg font-bold text-gray-800">LAeq {laeqResult.type || 'Result'}</h3>
              </div>
              <div className="text-3xl font-bold text-blue-700 flex items-center gap-2">
                <i className="fa fa-microphone"></i>
                {laeqResult.laeq?.toFixed(1) || '0.0'}
                <span className="text-lg">dB(A)</span>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-white/60 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-600 mb-1">Total Records</div>
                <div className="text-sm font-bold text-gray-800">{laeqResult.totalRecords?.toLocaleString() || 0}</div>
              </div>
              {laeqResult.min !== undefined && laeqResult.max !== undefined && (
                <>
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-xs text-gray-600 mb-1">Min</div>
                    <div className="text-sm font-bold text-green-600">{laeqResult.min.toFixed(1)} dB</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2 text-center">
                    <div className="text-xs text-gray-600 mb-1">Max</div>
                    <div className="text-sm font-bold text-red-600">{laeqResult.max.toFixed(1)} dB</div>
                  </div>
                </>
              )}
            </div>
            
            {laeqResult.avg !== undefined && (
              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Average:</span>
                  <span className="text-lg font-bold text-blue-700">{laeqResult.avg.toFixed(1)} dB(A)</span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Chart */}
        <div className="bg-white p-3 rounded-lg border-2 border-gray-200 shadow-sm" style={{ height: "320px", position: "relative" }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <i className="fa fa-spinner fa-spin text-blue-600 text-2xl mb-2"></i>
                <p className="text-sm text-gray-600">Loading chart...</p>
              </div>
            </div>
          ) : filteredData.labels.length > 0 ? (
            <canvas ref={canvasRef} style={{ maxHeight: "320px" }} />
          ) : (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <i className="fa fa-chart-line text-gray-300 text-4xl mb-2"></i>
                <p className="text-gray-500">No data available</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="mt-4 space-y-2">
          <button
            onClick={downloadCSV}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-2.5 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm shadow-md hover:shadow-lg"
          >
            <i className="fa fa-download"></i>
            Download CSV
          </button>
          <button
            onClick={downloadChart}
            className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-2.5 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm shadow-md hover:shadow-lg"
          >
            <i className="fa fa-image"></i>
            Download Chart
          </button>
          <button
            onClick={onClose}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2.5 px-4 rounded-lg transition-all duration-200 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Memoize ChartPanel to prevent unnecessary re-renders
export default memo(ChartPanel);
