import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute, not './' — with real routes like /admin, a relative base
  // would resolve asset URLs against /admin/ instead of the site root and
  // break the build on any path deeper than /.
  base: '/',
  plugins: [react()],
  server: {
    watch: {
      // Desktop is iCloud-synced; iCloud's background sync repeatedly
      // touches files (vite.config.js especially), which chokidar reads
      // as real edits and restarts the whole dev server every ~10-30s,
      // never letting a page load finish. Wait for a file to stay quiet
      // before treating it as changed.
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    },
  },
});
