import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      fs: {
        // Retain Vite's default secret-file exclusions and also keep local
        // archives, audit caches and untracked notes out of the dev server.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '**/.data/**',
          '**/.cache/**',
          '**/docs/**',
        ],
      },
      proxy: {
        '/api': `http://127.0.0.1:${env.PORT || process.env.PORT || 3001}`,
      },
    },
  };
});
