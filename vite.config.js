import { defineConfig } from 'vite';

export default defineConfig({
    // Use relative base for GitHub Pages
    base: './',
    server: {
        port: 5173,
        open: true,
        proxy: {
            '/proxy/replicate': {
                target: 'https://api.replicate.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/proxy\/replicate/, ''),
                configure: (proxy, options) => {
                    proxy.on('proxyReq', (proxyReq, req, res) => {
                        console.log('Proxying to Replicate:', req.url);
                    });
                }
            }
        }
    },
    build: {
        outDir: 'dist',
        sourcemap: true
    }
});
