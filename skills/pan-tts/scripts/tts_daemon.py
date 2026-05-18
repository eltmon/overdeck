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
import math
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
DEFAULT_PORT = 8787
PORT_ENV = os.environ.get("QWEN_TTS_PORT", str(DEFAULT_PORT))
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
DEFAULT_MAX_QUEUE = 6
MAX_QUEUE_ENV = os.environ.get("QWEN_TTS_MAX_QUEUE", str(DEFAULT_MAX_QUEUE))
DEFAULT_MAX_REQUEST_BYTES = 64 * 1024
MAX_REQUEST_BYTES_ENV = os.environ.get("QWEN_TTS_MAX_REQUEST_BYTES", str(DEFAULT_MAX_REQUEST_BYTES))
DEFAULT_MAX_TEXT_CHARS = 4096
MAX_TEXT_CHARS_ENV = os.environ.get("QWEN_TTS_MAX_TEXT_CHARS", str(DEFAULT_MAX_TEXT_CHARS))
DEFAULT_MAX_EXTRACT_CHARS = 2000
MAX_EXTRACT_CHARS_ENV = os.environ.get("QWEN_TTS_MAX_EXTRACT_CHARS", str(DEFAULT_MAX_EXTRACT_CHARS))
DEFAULT_QWEN_SPEAKER_EMBEDDING_DIMS = 512
SPEAKER_EMBEDDING_DIMS_ENV = os.environ.get(
    "QWEN_TTS_SPEAKER_EMBEDDING_DIMS",
    str(DEFAULT_QWEN_SPEAKER_EMBEDDING_DIMS),
)
AUTH_TOKEN = os.environ.get("QWEN_TTS_AUTH_TOKEN", "").strip()
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get("QWEN_TTS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}
SAMPLE_RATE = 24000
PLAYER_IDLE_TIMEOUT = 10.0  # seconds to keep pw-play open after last utterance

PORT = DEFAULT_PORT
MAX_QUEUE = DEFAULT_MAX_QUEUE
MAX_REQUEST_BYTES = DEFAULT_MAX_REQUEST_BYTES
MAX_TEXT_CHARS = DEFAULT_MAX_TEXT_CHARS
MAX_EXTRACT_CHARS = DEFAULT_MAX_EXTRACT_CHARS
QWEN_SPEAKER_EMBEDDING_DIMS = DEFAULT_QWEN_SPEAKER_EMBEDDING_DIMS
MODEL: Qwen3TTSModel | None = None
WORK_QUEUE: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=MAX_QUEUE)
MODEL_LOCK = threading.Lock()
_MODEL_INIT_LOCK = threading.Lock()


def log(msg: str) -> None:
    print(f"[qwen-tts] {msg}", flush=True)


def parse_int_env(name: str, raw: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be <= {maximum}, got {value}")
    return value


def validate_text_field(value: Any, max_chars: int) -> str | None:
    text = str(value or "").strip()
    if not text or len(text) > max_chars:
        return None
    return text


def normalize_clone_embedding(embedding_data: Any) -> list[float]:
    if not isinstance(embedding_data, list):
        raise ValueError("invalid_embedding")
    if not embedding_data or len(embedding_data) > QWEN_SPEAKER_EMBEDDING_DIMS:
        raise ValueError("invalid_embedding")

    embedding: list[float] = []
    for value in embedding_data:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("invalid_embedding")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError("invalid_embedding")
        embedding.append(numeric_value)
    return embedding


def load_model() -> None:
    global MODEL
    if MODEL is not None:
        return
    with _MODEL_INIT_LOCK:
        if MODEL is not None:
            return
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
    with _MODEL_INIT_LOCK:
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
    with _MODEL_INIT_LOCK:
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
    audio = np.squeeze(audio)
    if audio.ndim == 2 and audio.shape[0] <= 2:
        audio = audio.T  # channels-last for soundfile
    if audio.ndim != 1:
        raise ValueError(f"Unexpected audio shape: {audio.shape}")
    return audio


def build_voice_clone_prompt(embedding_data: list) -> dict[str, Any]:
    assert MODEL_BASE is not None
    embedding = normalize_clone_embedding(embedding_data)
    spk_emb = torch.tensor(embedding, dtype=torch.bfloat16, device=MODEL_BASE.device)
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


def extract_embedding(design: str, text: str) -> list:
    tmp_path = None
    try:
        load_design_model()
        assert MODEL_DESIGN is not None
        with MODEL_LOCK:
            result = MODEL_DESIGN.generate_voice_design(
                text=text,
                language="English",
                instruct=design,
            )
        audio = _extract_audio(result)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_path = f.name
        sf.write(tmp_path, audio, samplerate=SAMPLE_RATE)

        load_base_model()
        assert MODEL_BASE is not None
        with MODEL_LOCK:
            prompt_items = MODEL_BASE.create_voice_clone_prompt(
                ref_audio=tmp_path,
                ref_text=text,
                x_vector_only_mode=True,
            )
        if not prompt_items:
            raise ValueError("voice_clone_prompt_empty")
        spk_emb = prompt_items[0].ref_spk_embedding
        return spk_emb.detach().cpu().tolist()
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


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


def _ensure_player() -> tuple[subprocess.Popen, bool]:
    """Start or return the existing pw-play subprocess."""
    global _PLAYER_PROC
    created = False
    if _PLAYER_PROC is None or _PLAYER_PROC.poll() is not None:
        _PLAYER_PROC = subprocess.Popen(
            [
                "pw-play",
                "--rate", str(SAMPLE_RATE),
                "--format", "f32",
                "--channels", "1",
                "-",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        created = True
    return _PLAYER_PROC, created


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

    for attempt in range(2):
        player, created = _ensure_player()

        # Only probe PipeWire sink state when we spawn a fresh player. Reused
        # players already keep the sink warm, so the fast path can skip the
        # extra pactl subprocess overhead.
        sink_state = _get_default_sink_state() if created else "RUNNING"
        prepend_secs = 0.60 if sink_state == "SUSPENDED" else 0.05
        silence = np.zeros(int(SAMPLE_RATE * prepend_secs), dtype=audio.dtype)
        audio_to_play = np.concatenate([silence, audio])

        raw = audio_to_play.astype(np.float32).tobytes()
        try:
            player.stdin.write(raw)
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
            if job.get("type") == "extract-embedding":
                result_queue = job["result_queue"]
                try:
                    embedding = extract_embedding(job["design"], job["text"])
                    result_queue.put({"ok": True, "embedding": embedding})
                except Exception as exc:  # noqa: BLE001
                    log(f"extract-embedding failed: {exc}")
                    result_queue.put({"ok": False, "error": str(exc)})
                continue

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
                f"(rtf={gen_secs / max(dur, 0.001):.2f})"
            )
            play_audio(audio, job.get("volume", 1.0))
        except Exception as exc:  # noqa: BLE001
            log(f"synthesis failed: {exc}")
        finally:
            WORK_QUEUE.task_done()


BODY_TOO_LARGE = object()


class Handler(http.server.BaseHTTPRequestHandler):
    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin in ALLOWED_ORIGINS

    def _authorized(self) -> bool:
        header_token = self.headers.get("X-Panopticon-TTS-Token", "").strip()
        auth_header = self.headers.get("Authorization", "").strip()
        bearer_token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else ""
        return bool(AUTH_TOKEN) and (header_token == AUTH_TOKEN or bearer_token == AUTH_TOKEN)

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Panopticon-TTS-Token, Authorization")

    def _json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "queue": WORK_QUEUE.qsize(), "model": MODEL_ID, "pid": os.getpid()})
            return
        self._json(404, {"error": "not_found"})

    def _read_body(self) -> Any:
        raw_len = self.headers.get("Content-Length", "0") or "0"
        try:
            length = max(0, int(raw_len))
        except ValueError:
            length = 0
        if length > MAX_REQUEST_BYTES:
            return BODY_TOO_LARGE
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_POST(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "origin_not_allowed"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return

        body = self._read_body()
        if body is BODY_TOO_LARGE:
            self._json(413, {"error": "request_too_large"})
            return
        if not isinstance(body, dict):
            self._json(400, {"error": "expected_object"})
            return

        if self.path == "/speak":
            text = validate_text_field(body.get("text"), MAX_TEXT_CHARS)
            if not text:
                self._json(400, {"error": "invalid_text"})
                return
            embedding = body.get("embedding")
            if embedding is not None:
                try:
                    embedding = normalize_clone_embedding(embedding)
                except ValueError:
                    self._json(400, {"error": "invalid_embedding"})
                    return
            raw_volume = body.get("volume", 1.0)
            try:
                volume = float(raw_volume)
            except (ValueError, TypeError):
                self._json(400, {"error": "invalid_volume"})
                return
            try:
                WORK_QUEUE.put_nowait(
                    {
                        "text": text,
                        "voice": str(body.get("voice") or DEFAULT_VOICE),
                        "instruct": str(body.get("instruct") or DEFAULT_INSTRUCT),
                        "volume": volume,
                        "mode": str(body.get("mode") or "custom"),
                        "embedding": embedding,
                    }
                )
            except queue.Full:
                self._json(429, {"error": "queue_full", "depth": WORK_QUEUE.qsize()})
                return
            self._json(202, {"queued": True, "depth": WORK_QUEUE.qsize()})
            return

        if self.path == "/extract-embedding":
            design = validate_text_field(body.get("design"), MAX_EXTRACT_CHARS)
            text = validate_text_field(body.get("text"), MAX_EXTRACT_CHARS)
            if not design or not text:
                self._json(400, {"error": "missing_design_or_text"})
                return

            result_queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=1)
            try:
                WORK_QUEUE.put_nowait(
                    {
                        "type": "extract-embedding",
                        "design": design,
                        "text": text,
                        "result_queue": result_queue,
                    }
                )
            except queue.Full:
                self._json(429, {"error": "queue_full", "depth": WORK_QUEUE.qsize()})
                return

            try:
                result = result_queue.get(timeout=180)
            except queue.Empty:
                self._json(503, {"error": "extract_embedding_timeout"})
                return

            if result.get("ok"):
                self._json(200, {"embedding": result["embedding"]})
                return
            if result.get("error") == "voice_clone_prompt_empty":
                self._json(422, {"error": "voice_clone_prompt_empty"})
                return
            self._json(500, {"error": "extract_embedding_failed"})
            return

        self._json(404, {"error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def main() -> int:
    global PORT, MAX_QUEUE, MAX_REQUEST_BYTES, MAX_TEXT_CHARS, MAX_EXTRACT_CHARS, QWEN_SPEAKER_EMBEDDING_DIMS, WORK_QUEUE

    if not AUTH_TOKEN:
        log("QWEN_TTS_AUTH_TOKEN is required")
        return 1

    try:
        PORT = parse_int_env("QWEN_TTS_PORT", PORT_ENV, minimum=1, maximum=65535)
        MAX_QUEUE = parse_int_env("QWEN_TTS_MAX_QUEUE", MAX_QUEUE_ENV, minimum=1)
        MAX_REQUEST_BYTES = parse_int_env("QWEN_TTS_MAX_REQUEST_BYTES", MAX_REQUEST_BYTES_ENV, minimum=1)
        MAX_TEXT_CHARS = parse_int_env("QWEN_TTS_MAX_TEXT_CHARS", MAX_TEXT_CHARS_ENV, minimum=1)
        MAX_EXTRACT_CHARS = parse_int_env("QWEN_TTS_MAX_EXTRACT_CHARS", MAX_EXTRACT_CHARS_ENV, minimum=1)
        QWEN_SPEAKER_EMBEDDING_DIMS = parse_int_env(
            "QWEN_TTS_SPEAKER_EMBEDDING_DIMS",
            SPEAKER_EMBEDDING_DIMS_ENV,
            minimum=1,
        )
    except ValueError as exc:
        log(f"invalid env var: {exc}")
        return 1

    WORK_QUEUE = queue.Queue(maxsize=MAX_QUEUE)
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
