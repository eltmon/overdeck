# pan-workspace: Docker image for Overdeck remote workspaces on Fly.io
#
# Provides a complete development environment with:
# - Node.js 22 + pnpm
# - git, tmux, build tools
# - Claude Code CLI
# - Codex CLI (@openai/codex), re-pinned to home's version at provisioning
# - Overdeck CLI (`pan`, npm package @overdeck/core), pinned by OVERDECK_VERSION
# - Docker (docker.io + iptables) for gauntlet critics that run Compose stacks
# - Fly CLI (flyctl)
#
# CMD stays `sleep infinity`: a Fly machine starts `pan serve` by exec at
# provisioning (PAN-4652 D-5), and provisioning also starts dockerd.
#
# No sshd: Fly's hallpass provides `fly ssh console`/sftp and Machines exec.

FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    tmux \
    build-essential \
    python3 \
    python3-pip \
    jq \
    unzip \
    ca-certificates \
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Install Bun (Overdeck projects use bun install for workspace deps)
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Install GitHub CLI (gh) — required so synced gh auth works and
# `gh auth setup-git` can wire the git https credential helper for pushes
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Codex CLI for Codex conversations on Fly machines (PAN-4296). Provisioning
# re-pins it to home's version (npm install -g @openai/codex@<v>).
RUN npm install -g @openai/codex

# Overdeck: a Fly machine runs `pan serve` (PAN-4652). The version is
# re-pinned to home's at provisioning (npm install -g @overdeck/core@<v>).
ARG OVERDECK_VERSION=latest
RUN npm install -g @overdeck/core@${OVERDECK_VERSION}

# Docker for gauntlet critics that run Compose stacks (PAN-4652 OD-4).
# dockerd is started by provisioning, not by CMD.
RUN apt-get update && apt-get install -y docker.io iptables \
    && rm -rf /var/lib/apt/lists/*

# Install Fly CLI (flyctl)
RUN curl -L https://fly.io/install.sh | sh
ENV FLYCTL_INSTALL="/root/.fly"
ENV PATH="$FLYCTL_INSTALL/bin:$PATH"

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Keep the machine alive. Do NOT run our own sshd: Fly machines run hallpass
# (Fly's built-in SSH daemon, used by `fly ssh console`/sftp and the Machines
# exec API) on port 22 — a second sshd loses the bind, exits as PID 1, and
# kernel-panics the microVM.
CMD ["sleep", "infinity"]
