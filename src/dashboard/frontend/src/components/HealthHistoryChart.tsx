import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export interface HealthEvent {
  id: number;
  agentId: string;
  timestamp: string;
  state: 'active' | 'stale' | 'warning' | 'stuck';
  previousState?: string;
  source?: string;
  metadata?: Record<string, any>;
}

interface HealthHistoryChartProps {
  events: HealthEvent[];
  startTime: string;
  endTime: string;
}

const STATE_VALUES = {
  active: 4,
  stale: 3,
  warning: 2,
  stuck: 1,
};

const STATE_COLORS = {
  active: 'rgba(34, 197, 94, 0.6)', // green-500
  stale: 'rgba(234, 179, 8, 0.6)', // yellow-500
  warning: 'rgba(249, 115, 22, 0.6)', // orange-500
  stuck: 'rgba(239, 68, 68, 0.6)', // red-500
};

const STATE_BORDER_COLORS = {
  active: 'rgba(34, 197, 94, 1)',
  stale: 'rgba(234, 179, 8, 1)',
  warning: 'rgba(249, 115, 22, 1)',
  stuck: 'rgba(239, 68, 68, 1)',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HealthHistoryChart({
  events,
  startTime,
  endTime,
}: HealthHistoryChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!chartRef.current || events.length === 0) return;

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    // Destroy previous chart instance
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create time buckets (one per hour)
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const bucketSize = 3600000; // 1 hour in milliseconds
    const bucketCount = Math.ceil((end - start) / bucketSize);

    const labels: string[] = [];
    const dataPoints: number[] = [];
    const backgroundColors: string[] = [];
    const borderColors: string[] = [];

    // Create buckets
    for (let i = 0; i < bucketCount; i++) {
      const bucketTime = start + i * bucketSize;
      labels.push(formatTime(new Date(bucketTime).toISOString()));

      // Find the active state at this time
      let currentState: keyof typeof STATE_VALUES = 'active';
      for (const event of events) {
        const eventTime = new Date(event.timestamp).getTime();
        if (eventTime <= bucketTime) {
          currentState = event.state;
        } else {
          break;
        }
      }

      dataPoints.push(STATE_VALUES[currentState]);
      backgroundColors.push(STATE_COLORS[currentState]);
      borderColors.push(STATE_BORDER_COLORS[currentState]);
    }

    const chartData: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: 'Health State',
          data: dataPoints,
          fill: true,
          backgroundColor: (context) => {
            const index = context.dataIndex;
            return backgroundColors[index] || STATE_COLORS.active;
          },
          borderColor: (context) => {
            const index = context.dataIndex;
            return borderColors[index] || STATE_BORDER_COLORS.active;
          },
          borderWidth: 2,
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              const states = Object.entries(STATE_VALUES).find(([_, v]) => v === value);
              return states ? states[0].charAt(0).toUpperCase() + states[0].slice(1) : '';
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(75, 85, 99, 0.2)',
          },
          ticks: {
            color: 'rgba(156, 163, 175, 0.8)',
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          min: 0,
          max: 5,
          grid: {
            color: 'rgba(75, 85, 99, 0.2)',
          },
          ticks: {
            color: 'rgba(156, 163, 175, 0.8)',
            stepSize: 1,
            callback: (value) => {
              const states: Record<number, string> = {
                4: 'Active',
                3: 'Stale',
                2: 'Warning',
                1: 'Stuck',
              };
              return states[value as number] || '';
            },
          },
        },
      },
    };

    chartInstance.current = new ChartJS(ctx, {
      type: 'line',
      data: chartData,
      options,
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [events, startTime, endTime]);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        No health data to display
      </div>
    );
  }

  return (
    <div className="w-full h-64 relative">
      <canvas ref={chartRef} />
    </div>
  );
}
