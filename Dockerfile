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
# Default: install from bootarou fork (the original fbsobreira repo was deleted).
# Override at build time:  docker compose build --build-arg SYMBOL_BOOTSTRAP_REPO=https://github.com/<you>/symbol-bootstrap.git
ARG SYMBOL_BOOTSTRAP_REPO=https://github.com/bootarou/symbol-bootstrap.git
RUN npm install -g ${SYMBOL_BOOTSTRAP_REPO}

# Workaround: `npm install -g <git-url>` respects .npmignore / package.json
# "files", which can omit config/node/resources/*.mustache templates.
# These templates are required by nemgen during `symbol-bootstrap config`.
# We pack the installed package, extract the config/ tree, and restore it.
RUN SB_ROOT=$(npm root -g)/symbol-bootstrap \
    && if [ ! -f "$SB_ROOT/config/node/resources/config-node.properties.mustache" ]; then \
         cd /tmp \
         && npm pack symbol-bootstrap --pack-destination /tmp 2>/dev/null \
         && TARBALL=$(ls /tmp/symbol-bootstrap-*.tgz | head -1) \
         && tar xzf "$TARBALL" \
         && cp -r /tmp/package/config/* "$SB_ROOT/config/" \
         && cp -r /tmp/package/presets/* "$SB_ROOT/presets/" 2>/dev/null || true \
         && rm -rf /tmp/package /tmp/symbol-bootstrap-*.tgz \
         && echo "✅ Restored missing bootstrap templates to $SB_ROOT/config/" \
       ; else \
         echo "✅ Bootstrap templates already present" \
       ; fi

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

# Copy and prepare start script (normalize line endings for cross-platform compatibility)
COPY start.sh /start.sh
RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh

# Expose ports: 3000 (API+WS), 5173 (Vite dev), 80 (prod)
EXPOSE 3000 5173 80

CMD ["/start.sh"]
