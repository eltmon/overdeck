#!/usr/bin/env python3
"""
Qwen3-TTS HTTP daemon — keeps the 1.7B model resident in VRAM and speaks
strings on demand via POST /speak.

Designed as a backend for pan-tts (and anything else that wants a local
low-latency TTS endpoint). One worker thread drains a bounded queue, so
requests beyond max_queue are rejected with 429 rather than starting a
second GPU generation.

POST /speak           { "text": "...", "voice": "Vivian", "instruct": "..." }
POST /extract-embedding { "design": "...", "text": "..." }
GET  /health          { "ok": true, "queue": <depth>, "model": "..." }
"""

from __future__ import annotations

import http.server
import io
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

HOST = os.environ.get("QWEN_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("QWEN_TTS_PORT", "8787"))
MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
DEFAULT_VOICE = os.environ.get("QWEN_TTS_VOICE", "Vivian")
DEFAULT_INSTRUCT = os.environ.get(
    "QWEN_TTS_INSTRUCT",
    (
        "Speak like the Star Trek Enterprise ship computer: calm, measured, "
        "precise diction, neutral affect, subtly synthetic, each phrase "
        "cleanly articulated with a slight formal cadence and no emotional "
        "inflection."
    ),
)
MAX_QUEUE = int(os.environ.get("QWEN_TTS_MAX_QUEUE", "6"))
SAMPLE_RATE = 24000
PLAYER_IDLE_TIMEOUT = 10.0  # seconds to keep pw-play open after last utterance

MODEL: Qwen3TTSModel | None = None
WORK_QUEUE: "queue.Queue[dict[str, Any]]" = queue.Queue()
MODEL_LOCK = threading.Lock()


def log(msg: str) -> None:
    print(f"[qwen-tts] {msg}", flush=True)


def load_model() -> None:
    global MODEL
    log(f"loading {MODEL_ID} on cuda:0 (bfloat16)…")
    t0 = time.time()
    MODEL = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    log(f"model loaded in {time.time() - t0:.1f}s")


MODEL_DESIGN: Qwen3TTSModel | None = None


def load_design_model() -> None:
    global MODEL_DESIGN
    if MODEL_DESIGN is not None:
        return
    log("loading VoiceDesign model on cuda:0 (bfloat16)…")
    t0 = time.time()
    MODEL_DESIGN = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    log(f"VoiceDesign model loaded in {time.time() - t0:.1f}s")


MODEL_BASE: Qwen3TTSModel | None = None


def load_base_model() -> None:
    global MODEL_BASE
    if MODEL_BASE is not None:
        return
    log("loading Base model on cuda:0 (bfloat16)…")
    t0 = time.time()
    MODEL_BASE = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    log(f"Base model loaded in {time.time() - t0:.1f}s")


def _extract_audio(result: Any) -> np.ndarray:
    audio = result[0] if isinstance(result, (tuple, list)) else result
    if hasattr(audio, "cpu"):
        audio = audio.cpu()
    if hasattr(audio, "numpy"):
        audio = audio.numpy()
    return np.squeeze(audio)


def build_voice_clone_prompt(embedding_data: list) -> dict[str, Any]:
    assert MODEL_BASE is not None
    spk_emb = torch.tensor(embedding_data, dtype=torch.bfloat16, device=MODEL_BASE.device)
    return {
        "ref_code": [None],
        "ref_spk_embedding": [spk_emb],
        "x_vector_only_mode": [True],
        "icl_mode": [False],
    }


def synthesize(
    text: str,
    voice: str,
    instruct: str,
    mode: str = "custom",
    embedding: list | None = None,
) -> np.ndarray:
    if embedding is not None:
        load_base_model()
        assert MODEL_BASE is not None
        voice_clone_prompt = build_voice_clone_prompt(embedding)
        with MODEL_LOCK:
            result = MODEL_BASE.generate_voice_clone(
                text=text,
                language="English",
                voice_clone_prompt=voice_clone_prompt,
            )
        return _extract_audio(result)

    if mode == "design":
        load_design_model()
        assert MODEL_DESIGN is not None
        with MODEL_LOCK:
            result = MODEL_DESIGN.generate_voice_design(
                text=text,
                language="English",
                instruct=voice,
            )
        return _extract_audio(result)

    assert MODEL is not None
    with MODEL_LOCK:
        result = MODEL.generate_custom_voice(
            text=text,
            language="English",
            speaker=voice,
            instruct=instruct,
        )
    return _extract_audio(result)


# ─── Audio playback: persistent pw-play stream ────────────────────────────────

_PLAYER_PROC: subprocess.Popen | None = None


def _get_default_sink_state() -> str:
    """Return the state of the default PulseAudio/PipeWire sink."""
    try:
        default_result = subprocess.run(
            ["pactl", "info"],
            capture_output=True,
            text=True,
            check=False,
            timeout=2.0,
        )
        default_sink = ""
        for line in default_result.stdout.splitlines():
            if line.startswith("Default Sink:"):
                default_sink = line.split(":", 1)[1].strip()
                break
        if not default_sink:
            return "SUSPENDED"

        sinks_result = subprocess.run(
            ["pactl", "list", "short", "sinks"],
            capture_output=True,
            text=True,
            check=False,
            timeout=2.0,
        )
        for line in sinks_result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 5 and parts[1] == default_sink:
                return parts[4].strip()
    except Exception:
        pass
    return "SUSPENDED"


def _ensure_player() -> subprocess.Popen:
    """Start or return the existing pw-play subprocess."""
    global _PLAYER_PROC
    if _PLAYER_PROC is None or _PLAYER_PROC.poll() is not None:
        _PLAYER_PROC = subprocess.Popen(
            ["pw-play", "-"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return _PLAYER_PROC


def _close_player() -> None:
    """Close the pw-play subprocess so the audio sink can suspend."""
    global _PLAYER_PROC
    if _PLAYER_PROC is not None:
        try:
            _PLAYER_PROC.stdin.close()
        except OSError:
            pass
        try:
            _PLAYER_PROC.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            _PLAYER_PROC.kill()
            _PLAYER_PROC.wait()
        _PLAYER_PROC = None


def play_audio(audio: np.ndarray, volume: float = 1.0) -> None:
    if volume != 1.0:
        audio = audio * max(0.0, min(volume, 1.0))

    # Adapt silence prepend based on sink state.  When the sink is suspended
    # (cold start) we need enough headroom for PipeWire + USB DAC resume.
    # When the sink is already running the persistent pw-play stream keeps it
    # warm and only a tiny safety buffer is needed.
    sink_state = _get_default_sink_state()
    prepend_secs = 0.60 if sink_state == "SUSPENDED" else 0.05
    silence = np.zeros(int(SAMPLE_RATE * prepend_secs), dtype=audio.dtype)
    audio = np.concatenate([silence, audio])

    for attempt in range(2):
        player = _ensure_player()
        buf = io.BytesIO()
        sf.write(buf, audio, SAMPLE_RATE, format="WAV")
        try:
            player.stdin.write(buf.getvalue())
            player.stdin.flush()
            return
        except (BrokenPipeError, OSError):
            _close_player()
            if attempt == 0:
                continue
            raise


def worker() -> None:
    while True:
        try:
            job = WORK_QUEUE.get(timeout=PLAYER_IDLE_TIMEOUT)
        except queue.Empty:
            _close_player()
            continue
        try:
            t0 = time.time()
            audio = synthesize(
                job["text"],
                job["voice"],
                job["instruct"],
                job.get("mode", "custom"),
                job.get("embedding"),
            )
            gen_secs = time.time() - t0
            dur = len(audio) / SAMPLE_RATE
            log(
                f"spoke {dur:.1f}s in {gen_secs:.1f}s "
                f"(rtf={gen_secs / max(dur, 0.001):.2f}): {job['text'][:60]!r}"
            )
            play_audio(audio, job.get("volume", 1.0))
        except Exception as exc:  # noqa: BLE001
            log(f"synthesis failed: {exc}")
        finally:
            WORK_QUEUE.task_done()


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "queue": WORK_QUEUE.qsize(), "model": MODEL_ID})
            return
        self._json(404, {"error": "not_found"})

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_POST(self) -> None:  # noqa: N802
        body = self._read_body()

        if self.path == "/speak":
            text = str(body.get("text", "")).strip()
            if not text:
                self._json(400, {"error": "empty_text"})
                return
            if WORK_QUEUE.qsize() >= MAX_QUEUE:
                self._json(429, {"error": "queue_full", "depth": WORK_QUEUE.qsize()})
                return
            WORK_QUEUE.put(
                {
                    "text": text,
                    "voice": str(body.get("voice") or DEFAULT_VOICE),
                    "instruct": str(body.get("instruct") or DEFAULT_INSTRUCT),
                    "volume": float(body.get("volume", 1.0)),
                    "mode": str(body.get("mode", "custom")),
                    "embedding": body.get("embedding"),
                }
            )
            self._json(202, {"queued": True, "depth": WORK_QUEUE.qsize()})
            return

        if self.path == "/extract-embedding":
            design = str(body.get("design", "")).strip()
            text = str(body.get("text", "")).strip()
            if not design or not text:
                self._json(400, {"error": "missing_design_or_text"})
                return

            try:
                # 1. Generate audio with VoiceDesign
                load_design_model()
                assert MODEL_DESIGN is not None
                with MODEL_LOCK:
                    result = MODEL_DESIGN.generate_voice_design(
                        text=text,
                        language="English",
                        instruct=design,
                    )
                audio = _extract_audio(result)

                # 2. Save to temp file
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    sf.write(f.name, audio, samplerate=SAMPLE_RATE)
                    tmp_path = f.name

                # 3. Extract speaker embedding with Base model
                load_base_model()
                assert MODEL_BASE is not None
                with MODEL_LOCK:
                    prompt_items = MODEL_BASE.create_voice_clone_prompt(
                        ref_audio=tmp_path,
                        ref_text=text,
                        x_vector_only_mode=True,
                    )
                spk_emb = prompt_items[0].ref_spk_embedding
                embedding_list = spk_emb.detach().cpu().tolist()
                self._json(200, {"embedding": embedding_list})
            except Exception as exc:  # noqa: BLE001
                log(f"extract-embedding failed: {exc}")
                self._json(500, {"error": str(exc)})
            finally:
                if "tmp_path" in dir() or "tmp_path" in vars():
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
            return

        self._json(404, {"error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def main() -> int:
    load_model()
    threading.Thread(target=worker, daemon=True).start()
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening on http://{HOST}:{PORT}  (POST /speak, POST /extract-embedding, GET /health)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        _close_player()
    return 0


if __name__ == "__main__":
    sys.exit(main())
