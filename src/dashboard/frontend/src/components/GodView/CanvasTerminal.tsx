import { useRef, useEffect, useCallback } from 'react';

interface CanvasTerminalProps {
  lines: string[];
  rows?: number;
  fontSize?: number;
  className?: string;
}

const ANSI_COLORS: Record<string, string> = {
  '30': '#4a5568', '31': '#ff2d7c', '32': '#39ff14', '33': '#ffb800',
  '34': '#00d4ff', '35': '#9d4edd', '36': '#00d4ff', '37': '#e8edf8',
  '90': '#7a8aaa', '91': '#ff6b9d', '92': '#7eff6b', '93': '#ffd066',
  '94': '#6bdaff', '95': '#c07ef0', '96': '#6bdaff', '97': '#ffffff',
};

const ANSI_RESET = '#e8edf8';
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

interface TextSegment {
  text: string;
  color: string;
  bold: boolean;
}

function parseAnsiLine(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentColor = ANSI_RESET;
  let currentBold = false;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: raw.slice(lastIndex, match.index), color: currentColor, bold: currentBold });
    }
    lastIndex = match.index + match[0].length;

    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) { currentColor = ANSI_RESET; currentBold = false; }
      else if (code === 1) { currentBold = true; }
      else if (code === 22) { currentBold = false; }
      else if (ANSI_COLORS[String(code)]) { currentColor = ANSI_COLORS[String(code)]; }
    }
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex), color: currentColor, bold: currentBold });
  }
  return segments;
}

// Strip all ANSI codes for plain text measurement
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function CanvasTerminal({ lines, rows = 4, fontSize = 11, className = '' }: CanvasTerminalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const lineHeight = fontSize + 4;
    const height = rows * lineHeight + 8;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = 'rgba(10, 14, 26, 0.9)';
    ctx.fillRect(0, 0, width, height);

    // Font setup
    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    ctx.textBaseline = 'top';

    // Show last `rows` lines
    const displayLines = lines.slice(-rows);
    displayLines.forEach((rawLine, i) => {
      const y = 4 + i * lineHeight;
      const segments = parseAnsiLine(rawLine);
      let x = 6;

      for (const seg of segments) {
        ctx.font = `${seg.bold ? 'bold ' : ''}${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle = seg.color;
        // Clip text to canvas width
        const availableWidth = width - x - 6;
        if (availableWidth <= 0) break;

        const plain = stripAnsi(seg.text);
        const measured = ctx.measureText(plain).width;
        if (measured > availableWidth) {
          // Truncate
          let truncated = '';
          for (const char of plain) {
            if (ctx.measureText(truncated + char).width > availableWidth) break;
            truncated += char;
          }
          ctx.fillText(truncated, x, y);
          break;
        } else {
          ctx.fillText(plain, x, y);
          x += measured;
        }
      }
    });

    // Subtle scanline overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    for (let y = 0; y < height; y += 2) {
      ctx.fillRect(0, y, width, 1);
    }
  }, [lines, rows, fontSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const observer = new ResizeObserver(draw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} className={`w-full overflow-hidden rounded ${className}`}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
