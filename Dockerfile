# =============================================================================
# Symbol Custom Network Manager — Docker Image
# Includes: Node.js 20, Docker CLI, docker-compose, symbol-bootstrap
# =============================================================================
FROM node:20-bookworm

# Install Docker CLI to interact with host docker daemon (DinD pattern)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
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

# Install symbol-bootstrap.
# Default: the bootarou fork (the original fbsobreira repo was deleted).
#
# NOTE: installed via git clone, NOT `npm install -g <git-url>` — npm's
# git-dependency packing (the package.json "files" whitelist, prepack scripts,
# and an npm 10.8.x bug that symlinks the global package to its temporary cache
# clone) produced broken and partial installs.  A partial install then had two
# runtime consequences: the nemgen mustache templates were missing, and the
# launcher silently fell back to `npx symbol-bootstrap@<version>` from the
# public registry — a different package than the one built into this image.
# Cloning to a fixed path removes both failure modes, and matches how the PQC
# edition is installed.
#
# Override at build time:
#   docker compose build --build-arg SYMBOL_BOOTSTRAP_REPO=... --build-arg SYMBOL_BOOTSTRAP_BRANCH=...
ARG SYMBOL_BOOTSTRAP_REPO=https://github.com/bootarou/symbol-bootstrap.git
ARG SYMBOL_BOOTSTRAP_BRANCH=main
# Cache-bust: docker cannot see remote branch updates, so pin the clone layer to
# the current branch tip.  When the branch moves, this ADD's content changes and
# the layers below rebuild.  (Only meaningful for the default GitHub repo;
# override builds can pass --no-cache instead.)
ADD https://api.github.com/repos/bootarou/symbol-bootstrap/git/refs/heads/${SYMBOL_BOOTSTRAP_BRANCH} /tmp/symbol-bootstrap-ref.json
#
# The second npm install is not redundant: lib/service/VotingUtils.js does
# `require('tweetnacl')` without symbol-bootstrap declaring tweetnacl anywhere.
# It only ever resolved because npm happened to hoist the copy symbol-sdk depends
# on to the top level. In this dependency tree npm nests it under
# node_modules/symbol-sdk/node_modules instead, where `require('tweetnacl')` from
# lib/ cannot see it, and `symbol-bootstrap config` dies with MODULE_NOT_FOUND.
# Installing it explicitly makes the resolution independent of npm's hoisting.
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/* \
    && git clone --branch "${SYMBOL_BOOTSTRAP_BRANCH}" --depth 1 "${SYMBOL_BOOTSTRAP_REPO}" /opt/symbol-bootstrap \
    && cd /opt/symbol-bootstrap \
    && npm install --omit=dev --no-audit --no-fund \
    && npm install --omit=dev --no-audit --no-fund tweetnacl@^1.0.3 \
    && chmod +x /opt/symbol-bootstrap/bin/run \
    && ln -s /opt/symbol-bootstrap/bin/run /usr/local/bin/symbol-bootstrap \
    && symbol-bootstrap --version

# Sanity checks — fail the build here, where it is one line of output, instead of
# at a user's first node start:
#  1. nemgen mustache templates must be present, or `symbol-bootstrap config`
#     generates a config-node.properties without cache_database.maxLogFiles and
#     nemgen dies with "property not found".
#  2. the network presets must be present: the inflation and finalization
#     schedules shown when configuring or joining a network are read from them,
#     and a joining node that misses the inflation schedule diverges at the first
#     height that pays a block reward.
#  3. the config service must actually load. `symbol-bootstrap --version` only
#     exercises oclif, so it passed while a missing transitive dependency made
#     every `config` run fail with MODULE_NOT_FOUND. Loading the service pulls in
#     the real require graph, which is what users hit at Step 1.
RUN set -eu; \
    SB_ROOT=/opt/symbol-bootstrap; \
    test -f "$SB_ROOT/config/node/resources/config-node.properties.mustache" \
      || { echo "ERROR: bootstrap templates missing ($SB_ROOT/config)" >&2; exit 1; }; \
    test -f "$SB_ROOT/presets/shared.yml" \
      || { echo "ERROR: bootstrap presets missing ($SB_ROOT/presets)" >&2; exit 1; }; \
    node -e "require('$SB_ROOT/lib/service/ConfigService.js')" \
      || { echo "ERROR: symbol-bootstrap cannot load ConfigService - a dependency is missing" >&2; exit 1; }; \
    echo "symbol-bootstrap verified: templates + presets + config service load"

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY backend/package.json backend/package-lock.json* ./backend/
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# Use the same dependency fingerprint at build time and container startup.
COPY install-dependencies.sh /install-dependencies.sh
RUN sed -i 's/\r$//' /install-dependencies.sh && chmod +x /install-dependencies.sh \
    && /install-dependencies.sh /app/backend \
    && /install-dependencies.sh /app/frontend

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/
# Runtime configuration and backups are supplied by the shared bind mount.
RUN mkdir -p /app/shared

# Copy and prepare start script (normalize line endings for cross-platform compatibility)
COPY start.sh /start.sh
RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh

# Expose ports: 3000 (API+WS), 5173 (Vite dev), 80 (prod)
EXPOSE 3000 5173 80

CMD ["/start.sh"]
