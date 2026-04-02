// In production the backend serves the frontend, so same-origin works.
// In dev mode Vite proxies /api ↁEhttp://localhost:4000 (see vite.config.ts).
const API_BASE =
  import.meta.env.VITE_API_URL ?? '/api';

export { API_BASE };

// =============================================================================
// Auth token management
// =============================================================================

const AUTH_TOKEN_KEY = 'symbol-ui-auth-token';

export function getAuthToken(): string {
  try { return sessionStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; }
}

export function setAuthToken(token: string): void {
  try { sessionStorage.setItem(AUTH_TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearAuthToken(): void {
  try { sessionStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* ignore */ }
}

/** Build headers with auth token included. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** fetch wrapper that adds auth header automatically. */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = authHeaders(
    init?.headers ? Object.fromEntries(
      init.headers instanceof Headers
        ? init.headers.entries()
        : Object.entries(init.headers as Record<string, string>)
    ) : undefined
  );
  return fetch(url, { ...init, headers });
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────

  /** Check if authentication is required. */
  getAuthStatus: async (): Promise<{ authRequired: boolean }> => {
    try {
      const res = await fetch(`${API_BASE}/auth/status`);
      return res.json();
    } catch {
      return { authRequired: false };
    }
  },

  /** Login with admin password. */
  login: async (password: string): Promise<{ success: boolean; token: string }> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /** Verify current token is still valid. */
  verifyToken: async (): Promise<boolean> => {
    try {
      const res = await authFetch(`${API_BASE}/auth/verify`, { method: 'POST' });
      const data = await res.json();
      return data.valid === true;
    } catch {
      return false;
    }
  },

  // ── Preset CRUD ────────────────────────────────────────────────────────

  loadPreset: async () => {
    try {
      const res = await authFetch(`${API_BASE}/preset`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null; // Backend not running
    }
  },

  savePreset: async (preset: unknown) => {
    const res = await authFetch(`${API_BASE}/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    });
    return res.json();
  },

  // ── Addresses ──────────────────────────────────────────────────────────

  getAddresses: async () => {
    const res = await authFetch(`${API_BASE}/addresses`);
    if (!res.ok) throw new Error('Not found');
    return res.json();
  },

  // ── Download preset as YAML (server-generated) ─────────────────────────

  downloadPresetYaml: async () => {
    const res = await authFetch(`${API_BASE}/preset/download`);
    if (!res.ok) throw new Error('Failed to download');
    return res.text();
  },

  // ── Docker environment detection ───────────────────────────────────────

  getDockerEnv: async (): Promise<{ isDockerDesktop: boolean; os: string }> => {
    try {
      const res = await authFetch(`${API_BASE}/docker-env`);
      if (!res.ok) return { isDockerDesktop: false, os: 'unknown' };
      return res.json();
    } catch {
      return { isDockerDesktop: false, os: 'unknown' };
    }
  },

  // ── Network status ─────────────────────────────────────────────────────

  getStatus: async () => {
    const res = await authFetch(`${API_BASE}/status`);
    return res.json();
  },

  // ── Node health ────────────────────────────────────────────────────────

  getNodeHealth: async () => {
    try {
      const res = await authFetch(`${API_BASE}/node-health`);
      return res.json();
    } catch {
      return { status: 'unknown', statusCode: null, apiNode: '', db: '', lastCheck: '' };
    }
  },

  refreshNodeHealth: async () => {
    const res = await authFetch(`${API_BASE}/node-health/refresh`, { method: 'POST' });
    return res.json();
  },

  // ── Node statistics ────────────────────────────────────────────────────

  getNodeStats: async () => {
    const res = await authFetch(`${API_BASE}/node-stats`);
    return res.json();
  },

  // ── Storage usage ──────────────────────────────────────────────────────

  getStorage: async () => {
    const res = await authFetch(`${API_BASE}/storage`);
    return res.json();
  },

  // ── Certificate info ───────────────────────────────────────────────────

  getCertificateInfo: async () => {
    try {
      const res = await authFetch(`${API_BASE}/certificate-info`);
      return res.json();
    } catch {
      return { available: false };
    }
  },

  renewCertificate: async (password: string, force?: boolean) => {
    const res = await authFetch(`${API_BASE}/certificate-renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, force }),
    });
    return res.json();
  },

  getVolumes: async () => {
    const res = await authFetch(`${API_BASE}/storage/volumes`);
    return res.json();
  },

  setTargetDir: async (targetDir: string) => {
    const res = await authFetch(`${API_BASE}/storage/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDir }),
    });
    return res.json();
  },

  deleteDirectory: async (dirPath: string) => {
    const res = await authFetch(`${API_BASE}/storage/directory`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath }),
    });
    return res.json();
  },

  // ── Docker Image Management ────────────────────────────────────────────

  getImages: async () => {
    const res = await authFetch(`${API_BASE}/images`);
    return res.json();
  },

  getImageExportUrl: (image: string) => {
    const t = getAuthToken();
    const auth = t ? `&_token=${encodeURIComponent(t)}` : '';
    return `${API_BASE}/images/export?image=${encodeURIComponent(image)}${auth}`;
  },

  importImage: (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<{ success: boolean; output: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/images/import`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      const _token1 = getAuthToken();
      if (_token1) xhr.setRequestHeader('Authorization', `Bearer ${_token1}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status === 200) resolve(data);
          else reject(new Error(data.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  },

  // ── Join Network  Efetch from remote node ──────────────────────────────

  fetchNetworkFromNode: async (nodeUrl: string) => {
    const res = await authFetch(`${API_BASE}/network/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ── Commands ───────────────────────────────────────────────────────────

  sendCommand: async (command: string, payload?: Record<string, unknown>) => {
    const options: RequestInit = { method: 'POST' };
    if (payload) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }
    const res = await authFetch(`${API_BASE}/commands/${command}`, options);
    return res.json();
  },

  // ── Seed file import ───────────────────────────────────────────────────

  getSeedStatus: async () => {
    const res = await authFetch(`${API_BASE}/seed/status`);
    return res.json();
  },

  uploadSeedFiles: async (files: { name: string; data: string }[]) => {
    const res = await authFetch(`${API_BASE}/seed/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  clearSeed: async () => {
    const res = await authFetch(`${API_BASE}/seed`, { method: 'DELETE' });
    return res.json();
  },

  // ── Network Share ──────────────────────────────────────────────────────

  getShareStatus: async () => {
    const res = await authFetch(`${API_BASE}/share/status`);
    return res.json();
  },

  getShareExportUrl: (sourceNodeHint?: string) => {
    const t = getAuthToken();
    const parts: string[] = [];
    if (sourceNodeHint) parts.push(`sourceNodeHint=${encodeURIComponent(sourceNodeHint)}`);
    if (t) parts.push(`_token=${encodeURIComponent(t)}`);
    const qs = parts.length ? `?${parts.join('&')}` : '';
    return `${API_BASE}/share/export${qs}`;
  },

  importSharePackage: async (
    file: File,
  ): Promise<{
    success: boolean;
    metadata: Record<string, unknown>;
    config: Record<string, unknown>;
    seedFiles: string[];
    error?: string;
  }> => {
    const res = await authFetch(`${API_BASE}/share/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Import failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ── Address Viewer ─────────────────────────────────────────────────────

  decryptAddresses: async (password: string) => {
    const res = await authFetch(`${API_BASE}/addresses/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  getAddressBalances: async () => {
    const res = await authFetch(`${API_BASE}/addresses/balances`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ── Explorer Management ────────────────────────────────────────────────

  getExplorerStatus: async () => {
    try {
      const res = await authFetch(`${API_BASE}/explorer/status`);
      return res.json();
    } catch {
      return { status: 'error' };
    }
  },

  buildExplorer: async () => {
    const res = await authFetch(`${API_BASE}/explorer/build`, { method: 'POST' });
    return res.json();
  },

  startExplorer: async (config: {
    namespaceName: string;
    divisibility: string;
    port: number;
    networkName?: string;
    externalHost?: string;
  }) => {
    const res = await authFetch(`${API_BASE}/explorer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.json();
  },

  stopExplorer: async () => {
    const res = await authFetch(`${API_BASE}/explorer/stop`, { method: 'POST' });
    return res.json();
  },

  computeNamespaceId: async (name: string) => {
    try {
      const res = await authFetch(`${API_BASE}/explorer/namespace-id?name=${encodeURIComponent(name)}`);
      return res.json();
    } catch {
      return { error: 'fetch failed' };
    }
  },

  // ── Backup / Restore ───────────────────────────────────────────────────

  getBackupStatus: async () => {
    try {
      const res = await authFetch(`${API_BASE}/backup/status`);
      return res.json();
    } catch {
      return { canBackup: false, files: {}, nodeState: 'unknown' };
    }
  },

  getBackupDownloadUrl: () => {
    const t = getAuthToken();
    const auth = t ? `?_token=${encodeURIComponent(t)}` : '';
    return `${API_BASE}/backup${auth}`;
  },

  uploadRestore: async (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<{ success: boolean; restoredFiles: string[]; message: string; error?: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/restore`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      const _token2 = getAuthToken();
      if (_token2) xhr.setRequestHeader('Authorization', `Bearer ${_token2}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status === 200) resolve(data);
          else reject(new Error(data.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  },
};
