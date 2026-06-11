#!/usr/bin/env python3
import base64
import json
import os
import queue
import signal
import sys
import threading
import time

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
COMMIT_SILENCE_SECONDS = 0.45
MIN_COMMIT_BYTES = BYTES_PER_SECOND // 2
PARTIAL_INTERVAL_SECONDS = 0.5
MAX_PARTIAL_WINDOW_BYTES = BYTES_PER_SECOND * 10
BROWSER_AUDIO_FRAME_SAMPLES = 4096
MAX_QUEUE_AUDIO_SECONDS = 2
MAX_AUDIO_QUEUE_ITEMS = max(1, int(MAX_QUEUE_AUDIO_SECONDS * SAMPLE_RATE / BROWSER_AUDIO_FRAME_SAMPLES))
# A frame counts as speech when its RMS exceeds this level (float scale, 1.0 =
# full scale). 0.008 ~= -42 dBFS: conversational speech on typical mics sits
# around -30 to -20 dBFS while room noise stays below -50 dBFS. The browser
# streams frames continuously even when nobody is talking, so commit-on-silence
# must gate on speech energy, not on frame arrival.
VOICE_RMS_THRESHOLD = 0.008
# While no speech has been detected since the last commit, cap the buffer so an
# open mic can't grow it without bound; keep a short pre-roll for utterance onset.
MAX_SILENT_BUFFER_BYTES = BYTES_PER_SECOND * 4
SILENT_BUFFER_KEEP_BYTES = BYTES_PER_SECOND * 2


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def resolve_model(model_name):
    """Map a requested model name to a (model_path, ModelArch) pair.

    The ``tiny-en`` model ships bundled in the moonshine_voice package assets, so
    it works fully offline. ``base-en`` is downloaded from the Moonshine CDN on
    first use and cached. Anything else falls back to the bundled tiny model.
    """
    from moonshine_voice import ModelArch
    from moonshine_voice.utils import get_model_path

    name = (model_name or "").strip().lower().replace("moonshine/", "").replace("_", "-")

    if name in ("", "tiny", "tiny-en"):
        return str(get_model_path("tiny-en")), ModelArch.TINY

    if name in ("base", "base-en"):
        from moonshine_voice.download import get_model_for_language
        model_root, arch = get_model_for_language("en", ModelArch.BASE)
        return str(model_root), arch

    return str(get_model_path("tiny-en")), ModelArch.TINY


def load_model(model_name):
    try:
        from moonshine_voice import Transcriber
    except ImportError as error:
        raise RuntimeError(
            "Moonshine Python package is unavailable; run scripts/build-moonshine-sidecars.js to build inside its managed venv"
        ) from error

    model_path, model_arch = resolve_model(model_name)
    transcriber = Transcriber(model_path, model_arch)

    def transcribe(pcm_bytes):
        samples = pcm16_to_float32(pcm_bytes).tolist()
        if not samples:
            return ""
        transcript = transcriber.transcribe_without_streaming(samples, sample_rate=SAMPLE_RATE)
        return " ".join(line.text for line in transcript.lines if line.text).strip()

    return transcribe


def pcm16_to_float32(pcm_bytes):
    import numpy as np

    return np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0


def frame_rms(pcm_bytes):
    import numpy as np

    samples = pcm16_to_float32(pcm_bytes)
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples * samples)))


def main():
    model_name = os.environ.get("MOONSHINE_MODEL", "moonshine/base")
    transcribe = load_model(model_name)
    audio_queue = queue.Queue(maxsize=MAX_AUDIO_QUEUE_ITEMS)
    stopped = threading.Event()
    buffer = bytearray()
    has_voice = False
    last_voice_at = 0.0
    last_partial = ""
    last_partial_at = 0.0

    def commit_buffer():
        nonlocal has_voice, last_partial
        if not buffer:
            return
        pcm = bytes(buffer)
        buffer.clear()
        has_voice = False
        text = transcribe(pcm) if len(pcm) >= MIN_COMMIT_BYTES else ""
        if text:
            emit({"type": "transcript:committed", "text": text})
        elif last_partial:
            # The buffer produced no committed text (e.g. a cough); clear the
            # stale partial so it doesn't linger in the client preview.
            emit({"type": "transcript:partial", "text": ""})
        last_partial = ""

    def worker():
        nonlocal has_voice, last_voice_at, last_partial, last_partial_at
        while not stopped.is_set():
            try:
                chunks = [audio_queue.get(timeout=0.05)]
            except queue.Empty:
                if has_voice and time.monotonic() - last_voice_at >= COMMIT_SILENCE_SECONDS:
                    commit_buffer()
                continue
            # Drain everything queued while the previous transcription ran so a
            # slow partial pass can never back the queue up into dropped audio.
            while True:
                try:
                    chunks.append(audio_queue.get_nowait())
                except queue.Empty:
                    break
            finalize = False
            for chunk in chunks:
                if chunk is None:
                    finalize = True
                    continue
                buffer.extend(chunk)
                if frame_rms(chunk) >= VOICE_RMS_THRESHOLD:
                    has_voice = True
                    last_voice_at = time.monotonic()
            if finalize:
                commit_buffer()
                emit({"type": "transcript:finalized"})
                continue
            now = time.monotonic()
            if not has_voice:
                if len(buffer) > MAX_SILENT_BUFFER_BYTES:
                    del buffer[:-SILENT_BUFFER_KEEP_BYTES]
                continue
            if now - last_voice_at >= COMMIT_SILENCE_SECONDS:
                commit_buffer()
                continue
            if len(buffer) >= MIN_COMMIT_BYTES and now - last_partial_at >= PARTIAL_INTERVAL_SECONDS:
                partial_pcm = bytes(buffer[-MAX_PARTIAL_WINDOW_BYTES:])
                text = transcribe(partial_pcm)
                last_partial_at = now
                if text and text != last_partial:
                    emit({"type": "transcript:partial", "text": text})
                    last_partial = text

    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    threading.Thread(target=worker, daemon=True).start()
    emit({"type": "ready"})

    for line in sys.stdin:
        try:
            message = json.loads(line)
            message_type = message.get("type")
            if message_type == "audio":
                if message.get("encoding") != "pcm16le" or message.get("sampleRate") != SAMPLE_RATE:
                    emit({"type": "error", "error": f"expected pcm16le audio at {SAMPLE_RATE} Hz"})
                    continue
                try:
                    audio_queue.put(base64.b64decode(message.get("audio", "")), timeout=MAX_QUEUE_AUDIO_SECONDS)
                except queue.Full:
                    emit({"type": "error", "error": "moonshine audio queue is full"})
            elif message_type == "stop":
                try:
                    audio_queue.put(None, timeout=MAX_QUEUE_AUDIO_SECONDS)
                except queue.Full:
                    emit({"type": "error", "error": "moonshine audio queue is full"})
            elif message_type == "close":
                stopped.set()
                break
        except Exception as error:
            emit({"type": "error", "error": str(error)})

    stopped.set()


if __name__ == "__main__":
    main()
