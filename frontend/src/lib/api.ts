// In production the backend serves the frontend, so same-origin works.
// In dev mode Vite proxies /api → http://localhost:4000 (see vite.config.ts).
const API_BASE =
  import.meta.env.VITE_API_URL ?? '/api';

export { API_BASE };

export const api = {
  // ── Preset CRUD ────────────────────────────────────────────────────────

  loadPreset: async () => {
    try {
      const res = await fetch(`${API_BASE}/preset`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null; // Backend not running
    }
  },

  savePreset: async (preset: unknown) => {
    const res = await fetch(`${API_BASE}/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    });
    return res.json();
  },

  // ── Addresses ──────────────────────────────────────────────────────────

  getAddresses: async () => {
    const res = await fetch(`${API_BASE}/addresses`);
    if (!res.ok) throw new Error('Not found');
    return res.json();
  },

  // ── Download preset as YAML (server-generated) ─────────────────────────

  downloadPresetYaml: async () => {
    const res = await fetch(`${API_BASE}/preset/download`);
    if (!res.ok) throw new Error('Failed to download');
    return res.text();
  },

  // ── Network status ─────────────────────────────────────────────────────

  getStatus: async () => {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  // ── Node health ────────────────────────────────────────────────────────

  getNodeHealth: async () => {
    try {
      const res = await fetch(`${API_BASE}/node-health`);
      return res.json();
    } catch {
      return { status: 'unknown', statusCode: null, apiNode: '', db: '', lastCheck: '' };
    }
  },

  refreshNodeHealth: async () => {
    const res = await fetch(`${API_BASE}/node-health/refresh`, { method: 'POST' });
    return res.json();
  },

  // ── Node statistics ────────────────────────────────────────────────────

  getNodeStats: async () => {
    const res = await fetch(`${API_BASE}/node-stats`);
    return res.json();
  },

  // ── Storage usage ──────────────────────────────────────────────────────

  getStorage: async () => {
    const res = await fetch(`${API_BASE}/storage`);
    return res.json();
  },

  getVolumes: async () => {
    const res = await fetch(`${API_BASE}/storage/volumes`);
    return res.json();
  },

  setTargetDir: async (targetDir: string) => {
    const res = await fetch(`${API_BASE}/storage/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDir }),
    });
    return res.json();
  },

  deleteDirectory: async (dirPath: string) => {
    const res = await fetch(`${API_BASE}/storage/directory`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath }),
    });
    return res.json();
  },

  // ── Docker Image Management ────────────────────────────────────────────

  getImages: async () => {
    const res = await fetch(`${API_BASE}/images`);
    return res.json();
  },

  getImageExportUrl: (image: string) => {
    return `${API_BASE}/images/export?image=${encodeURIComponent(image)}`;
  },

  importImage: (
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<{ success: boolean; output: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/images/import`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

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

  // ── Join Network — fetch from remote node ──────────────────────────────

  fetchNetworkFromNode: async (nodeUrl: string) => {
    const res = await fetch(`${API_BASE}/network/fetch`, {
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
    const res = await fetch(`${API_BASE}/commands/${command}`, options);
    return res.json();
  },

  // ── Seed file import ───────────────────────────────────────────────────

  getSeedStatus: async () => {
    const res = await fetch(`${API_BASE}/seed/status`);
    return res.json();
  },

  uploadSeedFiles: async (files: { name: string; data: string }[]) => {
    const res = await fetch(`${API_BASE}/seed/upload`, {
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
    const res = await fetch(`${API_BASE}/seed`, { method: 'DELETE' });
    return res.json();
  },

  // ── Network Share ──────────────────────────────────────────────────────

  getShareStatus: async () => {
    const res = await fetch(`${API_BASE}/share/status`);
    return res.json();
  },

  getShareExportUrl: (sourceNodeHint?: string) => {
    const params = sourceNodeHint
      ? `?sourceNodeHint=${encodeURIComponent(sourceNodeHint)}`
      : '';
    return `${API_BASE}/share/export${params}`;
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
    const res = await fetch(`${API_BASE}/share/import`, {
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
    const res = await fetch(`${API_BASE}/addresses/decrypt`, {
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
    const res = await fetch(`${API_BASE}/addresses/balances`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ── Explorer Management ────────────────────────────────────────────────

  getExplorerStatus: async () => {
    try {
      const res = await fetch(`${API_BASE}/explorer/status`);
      return res.json();
    } catch {
      return { status: 'error' };
    }
  },

  buildExplorer: async () => {
    const res = await fetch(`${API_BASE}/explorer/build`, { method: 'POST' });
    return res.json();
  },

  startExplorer: async (config: {
    namespaceName: string;
    divisibility: string;
    port: number;
    networkName?: string;
  }) => {
    const res = await fetch(`${API_BASE}/explorer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.json();
  },

  stopExplorer: async () => {
    const res = await fetch(`${API_BASE}/explorer/stop`, { method: 'POST' });
    return res.json();
  },

  computeNamespaceId: async (name: string) => {
    try {
      const res = await fetch(`${API_BASE}/explorer/namespace-id?name=${encodeURIComponent(name)}`);
      return res.json();
    } catch {
      return { error: 'fetch failed' };
    }
  },
};
