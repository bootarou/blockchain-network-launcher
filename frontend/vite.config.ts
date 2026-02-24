import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        host: '0.0.0.0', // Bind to all interfaces in Docker
        port: 5173,      // Match the exposed port
        strictPort: true, // Fail if port is in use
        watch: {
            usePolling: true, // Fix for Windows/WSL file watching
        },
        hmr: {
            clientPort: 5173, // Force WebSocket to use this port
            host: 'localhost', // Or omit to inherit
        },
    },
})
