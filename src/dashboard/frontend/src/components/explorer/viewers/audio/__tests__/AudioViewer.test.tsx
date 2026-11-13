/** PAN-5188 WI-11: the audio viewer uses the native player and reports a playback failure. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AudioViewer, { AUDIO_FAILURE } from '../AudioViewer';

const SRC = '/api/explorer/download?root=r&path=song.mp3&inline=1';

describe('AudioViewer', () => {
  it('renders an audio element with controls, metadata preload and the src', () => {
    const { container } = render(<AudioViewer src={SRC} name="song.mp3" size={1572864} />);
    const audio = container.querySelector('audio')!;
    expect(audio.hasAttribute('controls')).toBe(true);
    expect(audio.getAttribute('preload')).toBe('metadata');
    expect(audio.getAttribute('src')).toBe(SRC);
    expect(screen.getByText('1.5 MB')).toBeTruthy();
  });

  it('shows the failure text when the audio cannot play', () => {
    const { container } = render(<AudioViewer src={SRC} name="song.mp3" size={10} />);
    fireEvent.error(container.querySelector('audio')!);
    expect(screen.getByRole('alert').textContent).toContain(AUDIO_FAILURE);
  });
});
