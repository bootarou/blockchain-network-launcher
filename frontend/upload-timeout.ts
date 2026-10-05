import type { Plugin } from 'vite';

// Match backend/server.ts. Node's default 300-second request deadline also
// applies to Vite's incoming HTTP server, before the API proxy is reached.
export const uploadRequestTimeout = 24 * 60 * 60 * 1000;

export function uploadTimeout(): Plugin {
    const configure = (server: { httpServer: { requestTimeout: number } | null }) => {
        if (server.httpServer) server.httpServer.requestTimeout = uploadRequestTimeout;
    };
    return {
        name: 'bnl-upload-timeout',
        configureServer: configure,
        configurePreviewServer: configure,
    };
}
