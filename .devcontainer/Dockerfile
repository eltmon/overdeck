# Development container for Panopticon Dashboard
FROM node:20-alpine

# Install development tools
RUN apk add --no-cache \
    git \
    curl \
    jq \
    bash

# Use existing node user (UID/GID 1000) from base image
# Set working directory
WORKDIR /workspaces/panopticon

# Pre-create directories with correct ownership
# This ensures named volumes are initialized with proper permissions
RUN mkdir -p /workspaces/panopticon/src/dashboard/frontend/node_modules \
    /workspaces/panopticon/src/dashboard/server/node_modules \
    /home/node/.npm && \
    chown -R node:node /workspaces/panopticon /home/node/.npm

# Switch to non-root user
USER node
