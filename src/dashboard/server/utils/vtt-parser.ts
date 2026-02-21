/**
 * VTT to Markdown converter for transcript uploads.
 * Converts WebVTT (.vtt) files to readable Markdown format.
 *
 * Features:
 * - Extracts speaker names from <v Name> tags
 * - Converts timestamps to MM:SS format
 * - Strips HTML tags and positioning metadata
 * - Decodes common HTML entities
 * - Consolidates consecutive same-speaker cues within 3 seconds
 * - Removes NOTE blocks and cue IDs
 */

interface ParsedCue {
  startTime: number; // seconds
  speaker: string;
  text: string;
}

/**
 * Convert WebVTT content to Markdown format.
 * If content is not valid VTT (missing WEBVTT header), returns content as-is.
 */
export function vttToMarkdown(vttContent: string): string {
  // Normalize line endings
  const normalized = vttContent.replace(/\r\n/g, '\n');

  // Validate WEBVTT header
  if (!normalized.trim().startsWith('WEBVTT')) {
    return vttContent; // Not a VTT file, return as-is
  }

  // Split into blocks by double newlines
  const blocks = normalized.split(/\n\n+/);

  const cues: ParsedCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // Skip header block (first block with WEBVTT)
    if (lines[0].startsWith('WEBVTT')) continue;

    // Skip NOTE blocks
    if (lines[0].startsWith('NOTE')) continue;

    // Find the timestamp line
    let timestampLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*/)) {
        timestampLineIndex = i;
        break;
      }
    }

    if (timestampLineIndex === -1) continue; // No timestamp found

    // Parse timestamp
    const timestampLine = lines[timestampLineIndex];
    const timestampMatch = timestampLine.match(/^((\d{1,2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*/);
    if (!timestampMatch) continue;

    const startTimestamp = timestampMatch[1];
    const startSeconds = parseTimestamp(startTimestamp);

    // Extract text lines (everything after timestamp)
    const textLines = lines.slice(timestampLineIndex + 1);
    if (textLines.length === 0) continue; // Empty cue

    // Join text lines and process
    let text = textLines.join(' ').trim();
    if (!text) continue;

    // Extract speaker from <v Name> tag
    let speaker = '';
    const speakerMatch = text.match(/^<v\s+([^>]+)>/i);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = text.replace(/^<v\s+[^>]+>/i, '').trim();
    }

    // Strip all HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = decodeHtmlEntities(text);

    if (!text) continue; // Empty after processing

    cues.push({
      startTime: startSeconds,
      speaker,
      text
    });
  }

  // Consolidate consecutive same-speaker cues within 3 seconds
  const consolidatedCues = consolidateSpeakerCues(cues);

  // Format as Markdown
  if (consolidatedCues.length === 0) {
    return '# Transcript\n\n(No cues found)\n';
  }

  let markdown = '# Transcript\n\n';

  for (const cue of consolidatedCues) {
    const timestamp = formatTimestamp(cue.startTime);
    if (cue.speaker) {
      markdown += `**[${timestamp}]** **${cue.speaker}:** ${cue.text}\n\n`;
    } else {
      markdown += `**[${timestamp}]** ${cue.text}\n\n`;
    }
  }

  return markdown;
}

/**
 * Parse VTT timestamp to seconds.
 * Supports: HH:MM:SS.mmm or MM:SS.mmm
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');

  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS.mmm
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }

  return 0;
}

/**
 * Format seconds to MM:SS.
 */
function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Consolidate consecutive cues from the same speaker within 3 seconds.
 */
function consolidateSpeakerCues(cues: ParsedCue[]): ParsedCue[] {
  if (cues.length === 0) return [];

  const consolidated: ParsedCue[] = [];
  let current = { ...cues[0] };

  for (let i = 1; i < cues.length; i++) {
    const cue = cues[i];
    const timeDiff = cue.startTime - current.startTime;

    // If same speaker and within 3 seconds, consolidate
    if (cue.speaker === current.speaker && timeDiff <= 3) {
      current.text = current.text + ' ' + cue.text;
    } else {
      consolidated.push(current);
      current = { ...cue };
    }
  }

  consolidated.push(current); // Don't forget the last one

  return consolidated;
}
