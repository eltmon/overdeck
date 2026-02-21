import { describe, it, expect } from 'vitest';
import { vttToMarkdown } from '../../../src/dashboard/server/utils/vtt-parser';

describe('vttToMarkdown', () => {
  it('should parse basic VTT file', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
Hello, this is a test.

00:05.000 --> 00:10.000
This is the second cue.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('# Transcript');
    expect(result).toContain('**[00:00]** Hello, this is a test.');
    expect(result).toContain('**[00:05]** This is the second cue.');
  });

  it('should extract speaker names from <v> tags', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
<v Alice>Hello everyone!

00:05.000 --> 00:10.000
<v Bob>Hi Alice, how are you?`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('**[00:00]** **Alice:** Hello everyone!');
    expect(result).toContain('**[00:05]** **Bob:** Hi Alice, how are you?');
  });

  it('should handle multi-line cues', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
This is a long sentence
that spans multiple lines
in the VTT file.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('This is a long sentence that spans multiple lines in the VTT file.');
  });

  it('should skip NOTE blocks', () => {
    const vtt = `WEBVTT

NOTE This is a comment

00:00.000 --> 00:05.000
Actual content here.

NOTE Another comment
with multiple lines

00:05.000 --> 00:10.000
More content.`;

    const result = vttToMarkdown(vtt);

    expect(result).not.toContain('This is a comment');
    expect(result).not.toContain('Another comment');
    expect(result).toContain('Actual content here.');
    expect(result).toContain('More content.');
  });

  it('should skip cue IDs', () => {
    const vtt = `WEBVTT

1
00:00.000 --> 00:05.000
First cue with ID.

intro
00:05.000 --> 00:10.000
Second cue with text ID.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('First cue with ID.');
    expect(result).toContain('Second cue with text ID.');
    // IDs should not appear in output
    expect(result).not.toMatch(/^1$/m);
    expect(result).not.toMatch(/^intro$/m);
  });

  it('should strip positioning metadata', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000 position:10% line:90%
Text with positioning.

00:05.000 --> 00:10.000 align:middle
More text.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('Text with positioning.');
    expect(result).toContain('More text.');
    expect(result).not.toContain('position:');
    expect(result).not.toContain('align:');
  });

  it('should strip HTML tags', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
<b>Bold text</b> and <i>italic text</i>.

00:05.000 --> 00:10.000
<u>Underlined</u> with <c.color>colored text</c>.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('Bold text and italic text.');
    expect(result).toContain('Underlined with colored text.');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
    expect(result).not.toContain('<u>');
    expect(result).not.toContain('<c.color>');
  });

  it('should decode HTML entities', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
Testing &amp; symbols: &lt; &gt; &quot; &apos; &nbsp;`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('Testing & symbols: < > " \' ');
    expect(result).not.toContain('&amp;');
    expect(result).not.toContain('&lt;');
    expect(result).not.toContain('&gt;');
  });

  it('should return content as-is for non-VTT files', () => {
    const notVtt = `This is just plain text
without a WEBVTT header.`;

    const result = vttToMarkdown(notVtt);

    expect(result).toBe(notVtt);
  });

  it('should handle empty VTT files', () => {
    const vtt = `WEBVTT`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('# Transcript');
    expect(result).toContain('(No cues found)');
  });

  it('should handle Windows line endings', () => {
    const vtt = `WEBVTT\r\n\r\n00:00.000 --> 00:05.000\r\nHello world.\r\n\r\n00:05.000 --> 00:10.000\r\nSecond cue.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('Hello world.');
    expect(result).toContain('Second cue.');
  });

  it('should format timestamps as MM:SS', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000
First.

01:30.500 --> 01:35.000
One minute thirty.

1:05:30.000 --> 1:05:35.000
Hour format.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('**[00:00]**');
    expect(result).toContain('**[01:30]**');
    expect(result).toContain('**[65:30]**'); // 1 hour 5 min 30 sec = 65:30
  });

  it('should skip empty cues', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:05.000


00:05.000 --> 00:10.000
<v Speaker>

00:10.000 --> 00:15.000
Actual content.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('Actual content.');
    // Should not have empty entries for the first two cues
    const cueCount = (result.match(/\*\*\[\d{2}:\d{2}\]\*\*/g) || []).length;
    expect(cueCount).toBe(1); // Only one cue with content
  });

  it('should consolidate consecutive same-speaker cues within 3 seconds', () => {
    const vtt = `WEBVTT

00:00.000 --> 00:02.000
<v Alice>First part.

00:02.500 --> 00:04.000
<v Alice>Second part.

00:06.000 --> 00:08.000
<v Alice>Third part after gap.

00:08.500 --> 00:10.000
<v Bob>Different speaker.`;

    const result = vttToMarkdown(vtt);

    // First two Alice cues should be consolidated (2.5s gap < 3s)
    expect(result).toContain('**[00:00]** **Alice:** First part. Second part.');

    // Third Alice cue is separate (6s - 2.5s = 3.5s gap > 3s from previous)
    expect(result).toContain('**[00:06]** **Alice:** Third part after gap.');

    // Bob is separate speaker
    expect(result).toContain('**[00:08]** **Bob:** Different speaker.');
  });

  it('should handle realistic Zoom VTT export', () => {
    const vtt = `WEBVTT

NOTE duration:"00:01:30.500"
NOTE language:en

1
00:00.500 --> 00:02.000
<v John Smith>Welcome everyone to today's meeting.

2
00:02.200 --> 00:04.000
<v John Smith>Let's start with the agenda.

3
00:08.200 --> 00:10.000
<v Jane Doe>Thanks John. I'd like to discuss &lt;project-alpha&gt;.

4
00:10.500 --> 00:12.000
<v Jane Doe>We made significant progress this week.`;

    const result = vttToMarkdown(vtt);

    expect(result).toContain('# Transcript');
    expect(result).not.toContain('NOTE');
    expect(result).not.toContain('duration:');

    // First two John cues should be consolidated (1.7s gap < 3s)
    expect(result).toContain("**John Smith:** Welcome everyone to today's meeting. Let's start with the agenda.");

    // Jane's cues should be consolidated (2.3s gap < 3s)
    expect(result).toContain('**Jane Doe:** Thanks John. I\'d like to discuss <project-alpha>. We made significant progress this week.');

    // HTML entities decoded
    expect(result).toContain('<project-alpha>');
    expect(result).not.toContain('&lt;');
    expect(result).not.toContain('&gt;');
  });
});
