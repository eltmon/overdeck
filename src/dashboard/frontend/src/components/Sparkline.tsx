/**
 * Sparkline — small inline line chart using Chart.js with no axes.
 */

import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler);

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  maxValue?: number;
}

export function Sparkline({ data, color = 'rgba(59,130,246,0.8)', height = 32, maxValue = 100 }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const chartData: ChartData<'line'> = {
      labels: data.map(() => ''),
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 1.5,
        fill: true,
        backgroundColor: color.replace(/[\d.]+\)$/, '0.15)'),
        pointRadius: 0,
        tension: 0.3,
      }],
    };

    const options: ChartOptions<'line'> = {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: maxValue },
      },
    };

    if (chartRef.current) {
      chartRef.current.data = chartData;
      chartRef.current.update('none');
    } else {
      chartRef.current = new ChartJS(canvas, { type: 'line', data: chartData, options });
    }

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update chart data without recreating
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.data.labels = data.map(() => '');
    chartRef.current.data.datasets[0].data = data;
    chartRef.current.update('none');
  }, [data]);

  return <canvas ref={canvasRef} width={80} height={height} style={{ display: 'block' }} />;
}
