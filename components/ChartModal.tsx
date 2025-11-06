"use client";

import { useRef, useEffect, useState } from "react";

interface ChartModalProps {
  isOpen: boolean;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
    }>;
  };
  onClose: () => void;
}

export default function ChartModal({ isOpen, data, onClose }: ChartModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filteredData, setFilteredData] = useState(data);

  useEffect(() => {
    // Set default date range from data
    if (data.labels.length > 0 && !startDate) {
      const dates = data.labels.map(label => new Date(label).getTime());
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      setStartDate(minDate.toISOString().slice(0, 16));
      setEndDate(maxDate.toISOString().slice(0, 16));
    }
  }, [data]);

  // Filter data based on date range
  useEffect(() => {
    if (startDate && endDate && data.labels.length > 0) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      
      const filtered = data.labels.map((label, idx) => ({
        label,
        value: data.datasets[0].data[idx],
        timestamp: new Date(label).getTime()
      })).filter(item => item.timestamp >= start && item.timestamp <= end);

      setFilteredData({
        labels: filtered.map(f => f.label),
        datasets: [{
          ...data.datasets[0],
          data: filtered.map(f => f.value)
        }]
      });
    } else {
      setFilteredData(data);
    }
  }, [startDate, endDate, data]);

  // Function to downsample data for smooth visualization
  const downsampleChartData = (data: typeof filteredData, maxPoints: number = 150) => {
    if (data.labels.length <= maxPoints) {
      return data;
    }
    
    const step = Math.ceil(data.labels.length / maxPoints);
    const downsampledLabels: string[] = [];
    const downsampledData: number[] = [];
    
    for (let i = 0; i < data.labels.length; i += step) {
      // Take average of points in this step for smoother trend
      const chunk = data.datasets[0].data.slice(i, Math.min(i + step, data.datasets[0].data.length));
      const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
      downsampledData.push(avg);
      downsampledLabels.push(data.labels[i]);
    }
    
    // Always include last point
    if (downsampledLabels[downsampledLabels.length - 1] !== data.labels[data.labels.length - 1]) {
      downsampledData.push(data.datasets[0].data[data.datasets[0].data.length - 1]);
      downsampledLabels.push(data.labels[data.labels.length - 1]);
    }
    
    return {
      labels: downsampledLabels,
      datasets: [{
        ...data.datasets[0],
        data: downsampledData
      }]
    };
  };

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    import("chart.js/auto").then((ChartModule) => {
      const Chart = ChartModule.Chart;
      
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }

      const ctx = canvasRef.current!.getContext("2d");
      if (!ctx) return;

      // Downsample data if too many points for smooth visualization
      const maxPoints = 150;
      const chartData = filteredData.labels.length > maxPoints
        ? downsampleChartData(filteredData, maxPoints)
        : filteredData;

      // Hide points if too many data points
      const shouldHidePoints = filteredData.labels.length > 50;

      // สร้าง gradient สวยงาม
      const gradient = ctx.createLinearGradient(0, 0, 0, canvasRef.current?.height || 400);
      const borderColor = chartData.datasets[0]?.borderColor || "rgba(59, 130, 246, 1)";
      gradient.addColorStop(0, borderColor.replace('1)', '0.4)'));
      gradient.addColorStop(0.5, borderColor.replace('1)', '0.2)'));
      gradient.addColorStop(1, borderColor.replace('1)', '0.05)'));

      chartInstanceRef.current = new Chart(ctx, {
        type: "line",
        data: {
          ...chartData,
          datasets: [{
            ...chartData.datasets[0],
            backgroundColor: gradient,
            tension: 0.7, // เพิ่ม tension ให้ smooth มากขึ้น
            pointRadius: shouldHidePoints ? 0 : 0, // ซ่อนจุดทั้งหมดเพื่อให้เห็น trend ชัดเจน
            pointHoverRadius: 6,
            pointBackgroundColor: 'rgba(59, 130, 246, 0.8)',
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            borderWidth: 3,
          }]
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
              text: "Noise Level History",
              font: { 
                size: 18, 
                weight: "bold",
                family: "'Inter', 'Segoe UI', sans-serif"
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
              borderColor: borderColor,
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
              min: Math.min(...filteredData.datasets[0].data) - 10,
              max: Math.max(...filteredData.datasets[0].data) + 10,
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
              offset: false, // ไม่มี offset เพื่อให้กราฟเต็มพื้นที่
              bounds: 'data', // ใช้ข้อมูลเต็มพื้นที่
              title: {
                display: false,
              },
              afterBuildTicks: function(axis: any) {
                const totalLabels = filteredData.labels.length;
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
                      label: filteredData.labels[labelIndex]
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
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [isOpen, filteredData]);

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

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <i className="fa fa-chart-line text-blue-600"></i>
            Noise Level History
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors text-2xl"
          >
            <i className="fa fa-times"></i>
          </button>
        </div>

        {/* Date Range Selector */}
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <label className="block text-sm font-bold text-gray-700 mb-2">Select Time Range:</label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End Time</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
        </div>
        
        <div style={{ height: "400px", position: "relative" }}>
          <canvas ref={canvasRef} style={{ maxHeight: "400px" }} />
        </div>
        
        <div className="flex gap-3 mt-4">
          <button
            onClick={downloadCSV}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
          >
            <i className="fa fa-download"></i>
            Download CSV
          </button>
          <button
            onClick={downloadChart}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
          >
            <i className="fa fa-image"></i>
            Download Chart
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-4 rounded-lg transition-all duration-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
