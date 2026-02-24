# =============================================================================
# Symbol Custom Network Manager — Docker Image
# Includes: Node.js 20, Docker CLI, docker-compose, symbol-bootstrap
# =============================================================================
FROM node:20-bookworm

# Install Docker CLI to interact with host docker daemon (DinD pattern)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# symbol-bootstrap calls the legacy "docker-compose" binary (with hyphen).
# Modern Docker only ships the "docker compose" plugin.  Create a shim script
# that forwards all arguments so both forms work.
RUN printf '#!/bin/sh\nexec docker compose "$@"\n' > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Install symbol-bootstrap globally
RUN npm install -g symbol-bootstrap@latest

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY backend/package.json backend/package-lock.json* ./backend/
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# Install dependencies
RUN cd backend && npm install && cd ../frontend && npm install

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY shared/ ./shared/

# Copy start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports: 3000 (API+WS), 5173 (Vite dev), 80 (prod)
EXPOSE 3000 5173 80

CMD ["/start.sh"]
