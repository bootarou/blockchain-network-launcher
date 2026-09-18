#!/usr/bin/env bash
# BNL bootstrap for Ubuntu running under WSL2.
# This script is intended to be called by install.ps1 as root.

set -Eeuo pipefail

BNL_REPO="https://github.com/bootarou/blockchain-network-launcher.git"
BNL_DIR="/opt/bnl"
BNL_WEB_URL="http://127.0.0.1:5173"
DOCKER_KEYRING="/etc/apt/keyrings/docker.asc"
DOCKER_SOURCE="/etc/apt/sources.list.d/docker.sources"

log() {
  printf '\n============================================================\n'
  printf ' BNL | %s\n' "$1"
  printf '============================================================\n'
}

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1" >&2
}

fail() {
  printf '[ERROR] %s\n' "$1" >&2
  exit 1
}

trap 'printf "[ERROR] BNL bootstrap failed at line %s\n" "$LINENO" >&2' ERR

if [[ "$(id -u)" -ne 0 ]]; then
  fail "install-wsl.sh must run as root"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "/etc/os-release was not found"
fi

# shellcheck disable=SC1091
. /etc/os-release

if [[ "${ID:-}" != "ubuntu" ]]; then
  fail "This installer currently supports Ubuntu only (detected: ${ID:-unknown})"
fi

log "Ubuntu ${VERSION_ID:-unknown} detected"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gnupg

ok "Base packages installed"

# ---------------------------------------------------------------------------
# Docker Engine + Compose plugin
# ---------------------------------------------------------------------------
log "Checking Docker Engine"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker Engine and Compose already installed"
else
  # Remove packages that conflict with Docker CE when present.
  conflicting=(docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc)
  installed_conflicts=()
  for pkg in "${conflicting[@]}"; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'ok installed'; then
      installed_conflicts+=("$pkg")
    fi
  done
  if ((${#installed_conflicts[@]})); then
    warn "Removing conflicting Docker packages: ${installed_conflicts[*]}"
    apt-get remove -y "${installed_conflicts[@]}"
  fi

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$DOCKER_KEYRING"
  chmod a+r "$DOCKER_KEYRING"

  cat > "$DOCKER_SOURCE" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: $DOCKER_KEYRING
EOF

  apt-get update
  apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
fi

if command -v systemctl >/dev/null 2>&1 && [[ "$(ps -p 1 -o comm=)" == "systemd" ]]; then
  systemctl enable --now docker
else
  warn "systemd is not PID 1; starting dockerd manually for this session"
  if ! pgrep -x dockerd >/dev/null 2>&1; then
    nohup dockerd >/var/log/bnl-dockerd.log 2>&1 &
    for _ in {1..30}; do
      docker info >/dev/null 2>&1 && break
      sleep 1
    done
  fi
fi

docker info >/dev/null 2>&1 || fail "Docker daemon is not responding"
docker compose version
ok "Docker Engine is ready"

# ---------------------------------------------------------------------------
# BNL repository
# ---------------------------------------------------------------------------
log "Preparing BNL repository"

if [[ -d "$BNL_DIR/.git" ]]; then
  cd "$BNL_DIR"
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Local changes detected in $BNL_DIR; skipping automatic git pull"
  else
    git fetch --prune origin
    git pull --ff-only
  fi
else
  if [[ -e "$BNL_DIR" ]]; then
    fail "$BNL_DIR exists but is not a Git repository"
  fi
  git clone "$BNL_REPO" "$BNL_DIR"
  cd "$BNL_DIR"
fi

ok "BNL repository ready at $BNL_DIR"

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || fail ".env.example not found in BNL repository"
  cp .env.example .env
  ok ".env created from .env.example"
else
  ok "Existing .env preserved"
fi

# ---------------------------------------------------------------------------
# Administrator password
# ---------------------------------------------------------------------------
# install.ps1 transfers the password through stdin into this root-only temp
# file.  Do not print its contents.  Existing active ADMIN_PASSWORD values
# always win so rerunning the installer cannot silently change credentials.
if grep -Eq '^[[:space:]]*ADMIN_PASSWORD=.+$' .env; then
  ok "Existing ADMIN_PASSWORD preserved"
  rm -f /tmp/bnl-admin-password
else
  [[ -f /tmp/bnl-admin-password ]] || fail "ADMIN_PASSWORD is not configured and no installer password was provided"
  # Defensive cleanup: the PowerShell side already uses Base64, but remove any
  # accidental CR/LF bytes before validating the recovered password.
  admin_password="$(tr -d '\r\n' < /tmp/bnl-admin-password)"
  rm -f /tmp/bnl-admin-password

  if [[ ! "$admin_password" =~ ^[A-Za-z0-9!@#%_.-]{8,64}$ ]]; then
    unset admin_password
    fail "Invalid BNL admin password format"
  fi

  admin_line="ADMIN_PASSWORD='${admin_password}'"
  if grep -Eq '^[[:space:]]*#?[[:space:]]*ADMIN_PASSWORD=' .env; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*ADMIN_PASSWORD=.*$|${admin_line}|" .env
  else
    printf '\n%s\n' "$admin_line" >> .env
  fi
  unset admin_password admin_line
  chmod 600 .env
  ok "ADMIN_PASSWORD configured"
fi

symbol_target_dir="$(grep -E '^[[:space:]]*SYMBOL_TARGET_DIR=' .env | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
symbol_target_dir="${symbol_target_dir:-/opt/symbol-target}"

case "$symbol_target_dir" in
  /*) ;;
  *) fail "SYMBOL_TARGET_DIR must be an absolute Linux path: $symbol_target_dir" ;;
esac

mkdir -p "$symbol_target_dir"
ok "Blockchain data directory: $symbol_target_dir"

# ---------------------------------------------------------------------------
# Build + launch
# ---------------------------------------------------------------------------
log "Building BNL"

COMPOSE_BAKE=false docker compose build

log "Starting BNL"
docker compose up -d

docker compose ps

# Readiness is checked from INSIDE the symbol-manager container.
# This deliberately avoids depending on WSL/Docker host-loopback forwarding,
# which can behave differently across WSL versions. /api/status may require
# authentication when ADMIN_PASSWORD is enabled, so any HTTP response below
# 500 (including 401/403/404) proves that the backend accepted the connection.
log "Waiting for BNL backend"

ready=0
last_http="000"
last_state="unknown"
for _ in {1..90}; do
  container_id="$(docker compose ps -q symbol-manager 2>/dev/null || true)"

  if [[ -n "$container_id" ]]; then
    last_state="$(docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true)"

    if [[ "$last_state" == "running" ]]; then
      last_http="$(docker compose exec -T symbol-manager \
        curl -sS -o /dev/null \
        --connect-timeout 1 --max-time 2 \
        -w '%{http_code}' \
        http://127.0.0.1:4000/api/status 2>/dev/null | tr -d '\r\n' || true)"

      case "$last_http" in
        1??|2??|3??|4??)
          ready=1
          break
          ;;
      esac
    fi
  fi

  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  warn "BNL backend did not become reachable in time (container=${last_state}, HTTP=${last_http}). Last logs:"
  docker compose ps || true
  docker compose logs --tail=100 || true
  exit 1
fi

ok "BNL backend is reachable inside container (HTTP ${last_http})"
printf '\nBNL Web UI: %s\n' "$BNL_WEB_URL"
printf 'BNL directory: %s\n' "$BNL_DIR"
