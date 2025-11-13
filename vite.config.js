import { defineConfig } from 'vite';

export default defineConfig({
    // Use relative base for GitHub Pages
    base: './',
    server: {
        port: 5173,
        open: true
    },
    build: {
        outDir: 'dist',
        sourcemap: true
    }
});
