/**
 * Generate a codebase evolution video using @napi-rs/canvas + ffmpeg
 * Creates frames showing git history, file growth, and cost over time
 */
import { createCanvas } from '@napi-rs/canvas';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION_SEC = 30;
const TOTAL_FRAMES = FPS * DURATION_SEC;

const OUT_DIR = '/home/eltmon/Projects/panopticon-cli/docs/token-spend-report';
const FRAMES_DIR = join(OUT_DIR, 'frames');

mkdirSync(FRAMES_DIR, { recursive: true });

// Gather git data
function gatherData() {
  const log = execSync('git log --format="%H|%ci" --reverse -- .', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const lines = log.trim().split('\n').filter(l => l.trim());

  const commits = [];
  for (const line of lines) {
    const [hash, date] = line.split('|');
    commits.push({ hash: hash.trim(), date: new Date(date.trim()) });
  }

  // Sample file counts
  const fileCounts = [];
  const step = Math.max(1, Math.floor(commits.length / 200));
  for (let i = 0; i < commits.length; i += step) {
    const c = commits[i];
    try {
      const count = parseInt(execSync(`git ls-tree -r --name-only ${c.hash} | wc -l`, { encoding: 'utf8' }).trim());
      fileCounts.push({ date: c.date, files: count });
    } catch (e) {}
  }

  // Cost data by date
  const costData = [
    {date:'2025-02-11',cost:0.17},{date:'2025-02-12',cost:0.93},{date:'2025-02-13',cost:0.03},{date:'2025-02-14',cost:0.93},{date:'2025-02-24',cost:0.99},
    {date:'2025-08-30',cost:0.34},{date:'2025-08-31',cost:1.86},{date:'2025-09-01',cost:0.06},{date:'2025-09-02',cost:1.86},{date:'2025-09-12',cost:1.98},
    {date:'2025-11-18',cost:0.17},{date:'2025-11-19',cost:0.93},{date:'2025-11-20',cost:0.03},{date:'2025-11-21',cost:0.93},{date:'2025-12-01',cost:0.99},
    {date:'2025-12-08',cost:851.02},{date:'2025-12-09',cost:4655.58},{date:'2025-12-10',cost:150.18},{date:'2025-12-11',cost:4655.57},{date:'2025-12-18',cost:0.17},
    {date:'2025-12-19',cost:0.93},{date:'2025-12-20',cost:0.03},{date:'2025-12-21',cost:4956.87},{date:'2025-12-28',cost:0.34},{date:'2025-12-29',cost:1.86},
    {date:'2025-12-30',cost:0.06},{date:'2025-12-31',cost:2.85},{date:'2026-01-10',cost:1.98},{date:'2026-01-17',cost:0.68},{date:'2026-01-18',cost:3.72},
    {date:'2026-01-19',cost:0.12},{date:'2026-01-20',cost:3.72},{date:'2026-01-30',cost:3.96},{date:'2026-02-06',cost:0.68},{date:'2026-02-07',cost:3.72},
    {date:'2026-02-08',cost:0.12},{date:'2026-02-09',cost:3.72},{date:'2026-02-16',cost:428.74},{date:'2026-02-17',cost:2855.67},{date:'2026-02-18',cost:529.12},
    {date:'2026-02-19',cost:2403.74},{date:'2026-02-20',cost:1.49},{date:'2026-02-21',cost:389.06},{date:'2026-02-22',cost:103.62},{date:'2026-02-23',cost:302.45},
    {date:'2026-02-24',cost:359.57},{date:'2026-02-25',cost:64.57},{date:'2026-02-26',cost:43.90},{date:'2026-02-27',cost:75.73},{date:'2026-02-28',cost:218.57},
    {date:'2026-03-01',cost:3303.48},{date:'2026-03-02',cost:547.64},{date:'2026-03-03',cost:114.04},{date:'2026-03-04',cost:283.20},{date:'2026-03-05',cost:248.31},
    {date:'2026-03-06',cost:598.63},{date:'2026-03-07',cost:573.25},{date:'2026-03-08',cost:788.76},{date:'2026-03-09',cost:305.62},{date:'2026-03-10',cost:702.49},
    {date:'2026-03-11',cost:153.35},{date:'2026-03-12',cost:100.12},{date:'2026-03-13',cost:72.27},{date:'2026-03-14',cost:641.64},{date:'2026-03-15',cost:359.16},
    {date:'2026-03-16',cost:805.58},{date:'2026-03-17',cost:1654.86},{date:'2026-03-18',cost:910.56},{date:'2026-03-19',cost:918.37},{date:'2026-03-20',cost:244.19},
    {date:'2026-03-21',cost:159.45},{date:'2026-03-22',cost:662.25},{date:'2026-03-23',cost:166.84},{date:'2026-03-24',cost:99.63},{date:'2026-03-25',cost:337.32},
    {date:'2026-03-26',cost:204.37},{date:'2026-03-27',cost:67.54},{date:'2026-03-28',cost:60.92},{date:'2026-03-29',cost:82.60},{date:'2026-03-30',cost:217.01},
    {date:'2026-03-31',cost:278.63},{date:'2026-04-01',cost:101.99},{date:'2026-04-02',cost:292.10},{date:'2026-04-03',cost:181.98},{date:'2026-04-04',cost:675.66},
    {date:'2026-04-05',cost:439.21},{date:'2026-04-06',cost:271.40},{date:'2026-04-07',cost:358.59},{date:'2026-04-08',cost:407.67},{date:'2026-04-09',cost:170.45},
    {date:'2026-04-10',cost:246.93},{date:'2026-04-11',cost:41.89}
  ].map(d => ({ date: new Date(d.date + 'T00:00:00Z'), cost: d.cost }));

  return { commits, fileCounts, costData };
}

const { commits, fileCounts, costData } = gatherData();

const startDate = commits[0].date;
const endDate = commits[commits.length - 1].date;
const totalMs = endDate - startDate;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getValueAtTime(data, targetDate, key) {
  for (let i = 0; i < data.length - 1; i++) {
    if (targetDate >= data[i].date && targetDate <= data[i + 1].date) {
      const t = (targetDate - data[i].date) / (data[i + 1].date - data[i].date);
      return lerp(data[i][key], data[i + 1][key], t);
    }
  }
  return data[data.length - 1]?.[key] || 0;
}

function getCumulativeCost(targetDate) {
  let sum = 0;
  for (const d of costData) {
    if (d.date <= targetDate) sum += d.cost;
    else break;
  }
  return sum;
}

function getCommitCount(targetDate) {
  let count = 0;
  for (const c of commits) {
    if (c.date <= targetDate) count++;
    else break;
  }
  return count;
}

// Colors
const BG = '#0a0a0f';
const SURFACE = '#12121a';
const TEXT = '#e8e8f0';
const MUTED = '#8a8a9a';
const ACCENT = '#6366f1';
const ACCENT2 = '#8b5cf6';
const ACCENT3 = '#06b6d4';
const SUCCESS = '#22c55e';

function drawFrame(frameNum) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const progress = frameNum / (TOTAL_FRAMES - 1);
  const currentDate = new Date(startDate.getTime() + totalMs * progress);

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Grid
  ctx.strokeStyle = 'rgba(99,102,241,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < WIDTH; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < HEIGHT; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  // Glow
  const gradient = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.3, 0, WIDTH * 0.5, HEIGHT * 0.3, WIDTH * 0.6);
  gradient.addColorStop(0, 'rgba(99,102,241,0.08)');
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 48px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Panopticon Evolution', WIDTH / 2, 70);

  ctx.fillStyle = MUTED;
  ctx.font = '20px "Inter", sans-serif';
  ctx.fillText('100% AI-Generated Code', WIDTH / 2, 105);

  // Date
  ctx.fillStyle = ACCENT;
  ctx.font = 'bold 28px "JetBrains Mono", monospace';
  ctx.fillText(currentDate.toISOString().split('T')[0], WIDTH / 2, 150);

  // Stats boxes
  const files = Math.round(getValueAtTime(fileCounts, currentDate, 'files'));
  const cost = getCumulativeCost(currentDate);
  const commitCount = getCommitCount(currentDate);

  function drawStatBox(x, y, label, value, color) {
    ctx.fillStyle = SURFACE;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const w = 280;
    const h = 120;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, h, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 36px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(value, x, y + 55);

    ctx.fillStyle = MUTED;
    ctx.font = '14px "Inter", sans-serif';
    ctx.fillText(label, x, y + 85);
  }

  drawStatBox(WIDTH * 0.2, 200, 'Commits', commitCount.toLocaleString(), ACCENT);
  drawStatBox(WIDTH * 0.5, 200, 'Files', files.toLocaleString(), ACCENT3);
  drawStatBox(WIDTH * 0.8, 200, 'Cost', '$' + cost.toFixed(0), SUCCESS);

  // File growth chart
  const chartX = 100;
  const chartY = 380;
  const chartW = WIDTH - 200;
  const chartH = 280;

  ctx.fillStyle = SURFACE;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(chartX, chartY, chartW, chartH, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Files in Repository', chartX + 20, chartY + 30);

  const maxFiles = fileCounts[fileCounts.length - 1].files;
  const graphX = chartX + 60;
  const graphY = chartY + 50;
  const graphW = chartW - 80;
  const graphH = chartH - 80;

  // Draw line
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < fileCounts.length; i++) {
    const f = fileCounts[i];
    const x = graphX + ((f.date - startDate) / totalMs) * graphW;
    const y = graphY + graphH - (f.files / maxFiles) * graphH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill area
  ctx.lineTo(graphX + graphW, graphY + graphH);
  ctx.lineTo(graphX, graphY + graphH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(99,102,241,0.1)';
  ctx.fill();

  // Current position dot
  const curX = graphX + progress * graphW;
  const curFiles = getValueAtTime(fileCounts, currentDate, 'files');
  const curY = graphY + graphH - (curFiles / maxFiles) * graphH;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(curX, curY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Y-axis labels
  ctx.fillStyle = MUTED;
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxFiles / 4) * i);
    const y = graphY + graphH - (i / 4) * graphH;
    ctx.fillText(val.toLocaleString(), graphX - 10, y + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(graphX, y);
    ctx.lineTo(graphX + graphW, y);
    ctx.stroke();
  }

  // Cost bar at bottom
  const barY = 720;
  const barH = 40;
  const maxCost = 41936;

  ctx.fillStyle = SURFACE;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(chartX, barY, chartW, 80, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Cumulative Cost', chartX + 20, barY + 30);

  const costBarW = (cost / maxCost) * (chartW - 80);
  const costBarX = chartX + 40;
  const costBarY = barY + 45;
  const costBarInnerW = chartW - 80;

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(costBarX, costBarY, costBarInnerW, barH, 8);
  ctx.fill();

  const costGrad = ctx.createLinearGradient(costBarX, 0, costBarX + costBarW, 0);
  costGrad.addColorStop(0, ACCENT);
  costGrad.addColorStop(1, ACCENT2);
  ctx.fillStyle = costGrad;
  ctx.beginPath();
  ctx.roundRect(costBarX, costBarY, Math.max(4, costBarW), barH, 8);
  ctx.fill();

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 16px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('$' + cost.toFixed(0), costBarX + costBarW + 12, costBarY + 27);

  // Commits visual at bottom
  const commitsY = 840;
  const commitsH = 120;
  const commitBoxSize = 8;
  const commitsPerRow = Math.floor((chartW - 40) / (commitBoxSize + 2));

  ctx.fillStyle = SURFACE;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(chartX, commitsY, chartW, commitsH, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Commit Activity', chartX + 20, commitsY + 30);

  const visibleCommits = commits.filter(c => c.date <= currentDate);
  for (let i = 0; i < visibleCommits.length; i++) {
    const row = Math.floor(i / commitsPerRow);
    const col = i % commitsPerRow;
    const x = chartX + 20 + col * (commitBoxSize + 2);
    const y = commitsY + 45 + row * (commitBoxSize + 2);
    if (y > commitsY + commitsH - 10) break;

    const cProgress = i / commits.length;
    const r = Math.floor(lerp(99, 34, cProgress));
    const g = Math.floor(lerp(102, 197, cProgress));
    const b = Math.floor(lerp(241, 94, cProgress));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, commitBoxSize, commitBoxSize);
  }

  // Progress bar
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, HEIGHT - 4, WIDTH * progress, 4);

  // Footer
  ctx.fillStyle = MUTED;
  ctx.font = '14px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Generated by Kimi 2.6  |  panopticon-cli.com  |  100% AI-Generated', WIDTH / 2, HEIGHT - 20);

  return canvas.encode('png');
}

console.log(`Generating ${TOTAL_FRAMES} frames...`);

for (let i = 0; i < TOTAL_FRAMES; i++) {
  const frameNum = String(i).padStart(5, '0');
  const png = await drawFrame(i);
  writeFileSync(join(FRAMES_DIR, `frame-${frameNum}.png`), png);

  if (i % 30 === 0) {
    console.log(`  Frame ${i}/${TOTAL_FRAMES} (${((i / TOTAL_FRAMES) * 100).toFixed(0)}%)`);
  }
}

console.log('Encoding video with ffmpeg...');
execSync(
  `ffmpeg -y -framerate ${FPS} -i ${FRAMES_DIR}/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 23 -preset fast ${join(OUT_DIR, 'panopticon-evolution.mp4')}`,
  { stdio: 'inherit' }
);

console.log('Video saved to:', join(OUT_DIR, 'panopticon-evolution.mp4'));

// Clean up frames
execSync(`rm -rf ${FRAMES_DIR}`);
console.log('Done!');
