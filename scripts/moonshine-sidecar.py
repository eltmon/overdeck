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
MAX_PARTIAL_WINDOW_BYTES = BYTES_PER_SECOND * 3
BROWSER_AUDIO_FRAME_SAMPLES = 4096
MAX_QUEUE_AUDIO_SECONDS = 2
MAX_AUDIO_QUEUE_ITEMS = max(1, int(MAX_QUEUE_AUDIO_SECONDS * SAMPLE_RATE / BROWSER_AUDIO_FRAME_SAMPLES))


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


def main():
    model_name = os.environ.get("MOONSHINE_MODEL", "moonshine/base")
    transcribe = load_model(model_name)
    audio_queue = queue.Queue(maxsize=MAX_AUDIO_QUEUE_ITEMS)
    stopped = threading.Event()
    buffer = bytearray()
    last_audio_at = 0.0
    last_partial = ""
    last_partial_at = 0.0

    def commit_buffer():
        nonlocal last_partial
        if not buffer:
            return
        pcm = bytes(buffer)
        buffer.clear()
        if len(pcm) >= MIN_COMMIT_BYTES:
            text = transcribe(pcm)
            if text:
                emit({"type": "transcript:committed", "text": text})
                last_partial = ""

    def worker():
        nonlocal last_audio_at, last_partial, last_partial_at
        while not stopped.is_set():
            try:
                chunk = audio_queue.get(timeout=0.05)
            except queue.Empty:
                if buffer and time.monotonic() - last_audio_at >= COMMIT_SILENCE_SECONDS:
                    commit_buffer()
                continue
            if chunk is None:
                commit_buffer()
                emit({"type": "transcript:finalized"})
                continue
            buffer.extend(chunk)
            last_audio_at = time.monotonic()
            if len(buffer) >= MIN_COMMIT_BYTES and last_audio_at - last_partial_at >= PARTIAL_INTERVAL_SECONDS:
                partial_pcm = bytes(buffer[-MAX_PARTIAL_WINDOW_BYTES:])
                text = transcribe(partial_pcm)
                last_partial_at = last_audio_at
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
                    emit({"type": "error", "error": "expected pcm16le audio at 24000 Hz"})
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
