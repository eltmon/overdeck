# Development container for Overdeck Dashboard
FROM node:22-alpine

# Install development tools
RUN apk add --no-cache \
    git \
    curl \
    jq \
    bash \
    tmux \
    unzip

# Install Bun system-wide
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash && \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx

# Use existing node user (UID/GID 1000) from base image
# Set working directory
WORKDIR /workspaces/overdeck

# Pre-create directories with correct ownership
# Only root node_modules is shadowed by a named volume — Bun hoists all deps there.
# Host and container each run their own `bun install` independently.
RUN mkdir -p /workspaces/overdeck/node_modules \
    /home/node/.npm && \
    chown -R node:node /workspaces/overdeck /home/node/.npm

# Switch to non-root user
USER node
