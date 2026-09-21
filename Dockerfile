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
# We pack the published package, extract the config/ tree, and restore it.
#
# The closing check is what makes this safe.  The previous version ended the
# restore chain with `|| true`, so a failing `npm pack`/`tar`/`cp` still let the
# RUN succeed - and, because `&&` and `||` bind equally and left to right, it
# even printed the success message.  The image then shipped without templates
# and the problem only surfaced much later, at a user's first node start, as
# "property not found (cache_database, maxLogFiles)" from nemgen.  Fail here
# instead, where it is one line of build output.
RUN set -eu; \
    SB_ROOT="$(npm root -g)/symbol-bootstrap"; \
    TEMPLATE="$SB_ROOT/config/node/resources/config-node.properties.mustache"; \
    if [ ! -f "$TEMPLATE" ]; then \
      echo "Bootstrap templates missing - restoring from the published package"; \
      cd /tmp; \
      npm pack symbol-bootstrap --pack-destination /tmp; \
      TARBALL="$(ls /tmp/symbol-bootstrap-*.tgz | head -1)"; \
      tar xzf "$TARBALL"; \
      mkdir -p "$SB_ROOT/config" "$SB_ROOT/presets"; \
      cp -r /tmp/package/config/. "$SB_ROOT/config/"; \
      if [ -d /tmp/package/presets ]; then cp -r /tmp/package/presets/. "$SB_ROOT/presets/"; fi; \
      rm -rf /tmp/package /tmp/symbol-bootstrap-*.tgz; \
    fi; \
    if [ ! -f "$TEMPLATE" ]; then \
      echo "ERROR: $TEMPLATE is still missing - nemgen would fail at runtime" >&2; \
      exit 1; \
    fi; \
    echo "Bootstrap templates present: $TEMPLATE"

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
