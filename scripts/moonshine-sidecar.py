#!/usr/bin/env python3
import base64
import json
import os
import queue
import signal
import sys
import threading
import time
import wave
from io import BytesIO

SAMPLE_RATE = 24000
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


def load_model(model_name):
    try:
        from moonshine_onnx import MoonshineOnnxModel, load_tokenizer
        model = MoonshineOnnxModel(model_name=model_name)
        tokenizer = load_tokenizer()

        def transcribe(pcm_bytes):
            samples = pcm16_to_float32(pcm_bytes)
            tokens = model.generate(samples)
            return tokenizer.decode_batch(tokens)[0].strip()

        return transcribe
    except ImportError:
        try:
            from moonshine import MoonshineModel
            model = MoonshineModel(model_name)

            def transcribe(pcm_bytes):
                wav = pcm16_to_wav(pcm_bytes)
                return str(model.transcribe(wav)).strip()

            return transcribe
        except ImportError as error:
            raise RuntimeError(
                "Moonshine Python package is unavailable; run scripts/build-moonshine-sidecars.js to build inside its managed venv"
            ) from error


def pcm16_to_float32(pcm_bytes):
    import numpy as np

    return np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0


def pcm16_to_wav(pcm_bytes):
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm_bytes)
    output.seek(0)
    return output


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
