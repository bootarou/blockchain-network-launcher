# =============================================================================
# BNL Post-Quantum Catapult Network Manager — Docker Image
# Includes: Node.js 20, Docker CLI, docker-compose, symbol-bootstrap (PQC edition)
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

# Install symbol-bootstrap — PQC edition.
# Default: the feat-empty-block-policy branch (pqc-bootstrap + emptyBlockPolicy /
# emptyBlockHeartbeatInterval rendering in config-network.properties and the
# 1.0.3.9-bnl-ebp server image in presets/shared.yml).
# NOTE: installed via git clone + npm ci, NOT `npm install -g <git-url>` — npm's
# git-dependency packing (package.json "files" whitelist, prepack scripts, and a
# npm 10.8.x symlink-to-tmp-clone bug) produced broken/partial installs.
# Override at build time:
#   docker compose build --build-arg SYMBOL_BOOTSTRAP_REPO=... --build-arg SYMBOL_BOOTSTRAP_BRANCH=...
ARG SYMBOL_BOOTSTRAP_REPO=https://github.com/bootarou/symbol-bootstrap.git
ARG SYMBOL_BOOTSTRAP_BRANCH=feat-empty-block-policy
# Cache-bust: docker cannot see remote branch updates, so pin the clone layer
# to the current branch tip. When the branch moves, this ADD's content changes
# and the layers below rebuild. (Only meaningful for the default GitHub repo;
# override builds can pass --no-cache instead.)
ADD https://api.github.com/repos/bootarou/symbol-bootstrap/git/refs/heads/${SYMBOL_BOOTSTRAP_BRANCH} /tmp/symbol-bootstrap-ref.json
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/* \
    && git clone --branch "${SYMBOL_BOOTSTRAP_BRANCH}" --depth 1 "${SYMBOL_BOOTSTRAP_REPO}" /opt/symbol-bootstrap \
    && cd /opt/symbol-bootstrap \
    && npm install --omit=dev --no-audit --no-fund \
    && chmod +x /opt/symbol-bootstrap/bin/run \
    && ln -s /opt/symbol-bootstrap/bin/run /usr/local/bin/symbol-bootstrap \
    && symbol-bootstrap --version

# Sanity checks — fail the build early instead of producing a launcher that
# silently generates classic (ed25519) networks:
#  1. nemgen mustache templates must be present.
#  2. CertificateService must be the ML-DSA-44 (PQC) variant.
#  3. presets/shared.yml must reference the PQC server image.
RUN SB_ROOT=/opt/symbol-bootstrap \
    && test -f "$SB_ROOT/config/node/resources/config-node.properties.mustache" \
       || { echo "❌ bootstrap templates missing ($SB_ROOT/config)"; exit 1; } \
    && grep -q 'ML-DSA' "$SB_ROOT/lib/service/CertificateService.js" \
       || { echo "❌ installed symbol-bootstrap is not the PQC (ML-DSA-44) edition"; exit 1; } \
    && grep -q 'bnl-catapult-server-pqc' "$SB_ROOT/presets/shared.yml" \
       || { echo "❌ presets/shared.yml does not reference the PQC server image"; exit 1; } \
    && echo "✅ PQC symbol-bootstrap verified (templates + ML-DSA certs + PQC presets)"

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
