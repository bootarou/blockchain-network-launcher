const API_BASE =
  import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:4000/api`;

export const api = {
  // ── Preset CRUD ────────────────────────────────────────────────────────

  loadPreset: async () => {
    const res = await fetch(`${API_BASE}/preset`);
    if (!res.ok) return null;
    return res.json();
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
    const res = await fetch(`${API_BASE}/node-health`);
    return res.json();
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
};
