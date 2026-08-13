# PAN-1641 local Ollama verification

Verified on 2026-08-13 with oh-my-pi `omp` 16.3.11, Ollama 0.32.9, and
`gemma4:12b` on an NVIDIA RTX 3090.

## Overdeck pre-spawn gate

With the Ollama server listening on `127.0.0.1:11434`, the implemented provider
path completed its endpoint and model checks and returned only the local
OpenAI-compatible environment:

```text
{"OPENAI_BASE_URL":"http://localhost:11434/v1","OPENAI_API_KEY":"ollama"}
```

The oh-my-pi registry resolved the provisioned model as
`ollama/gemma4:12b`, with zero input, output, and cache cost.

## End-to-end inference

The inference run removed all Anthropic credentials and endpoints, supplied
only the dummy Ollama key and localhost endpoint, disabled tools and session
persistence, and asked the model for an exact sentinel response:

```bash
env -u ANTHROPIC_API_KEY \
  -u ANTHROPIC_AUTH_TOKEN \
  -u ANTHROPIC_BASE_URL \
  -u OPENAI_API_KEY \
  -u OPENAI_BASE_URL \
  OPENAI_API_KEY=ollama \
  OPENAI_BASE_URL=http://127.0.0.1:11434/v1 \
  omp --model ollama/gemma4:12b \
  --print --no-tools --no-session --max-time 180 \
  "Reply with exactly LOCAL_OK and nothing else."
```

oh-my-pi exited successfully with:

```text
LOCAL_OK
```

## Zero-cloud evidence

The temporary Ollama server ran with `OLLAMA_NO_CLOUD=true`. Its startup log
reported `Ollama cloud disabled: true`, `Listening on 127.0.0.1:11434`, and
model loading from the local `~/.ollama/models/blobs/` store. The completed
request log contained one inference request, sourced from loopback:

```text
[GIN] 2026/08/13 - 10:56:30 | 200 | 1m54s | 127.0.0.1 | POST "/v1/responses"
```

No Anthropic or OpenAI cloud credential was present in the client process, and
the server's cloud transport was disabled. The successful sentinel response
therefore proves the Pi request completed through the local Ollama endpoint.
