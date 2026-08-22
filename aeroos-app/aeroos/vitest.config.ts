import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // Garantit NODE_ENV=test même si le shell l'a défini autrement —
    // src/lib/logger.ts s'en sert pour désactiver le transport
    // pino-pretty (worker thread) pendant les tests.
    env: { NODE_ENV: 'test' },
    setupFiles: ['./vitest.setup.ts'],
    // Les tests d'intégration partagent la connexion Postgres locale
    // (même base que `npm run test:isolation`) — les paralléliser par
    // fichier créerait des transactions concurrentes sur des tenants
    // jetables indépendants, ce qui fonctionne, mais un run séquentiel
    // est plus simple à diagnostiquer en cas d'échec et évite d'épuiser
    // le pool de connexions Prisma en CI.
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/__tests__/**',
        'src/lib/ai/**', // nécessite ANTHROPIC_API_KEY, indisponible dans cet environnement
        'src/lib/storage/s3.ts', // nécessite des identifiants AWS
      ],
    },
  },
});
