import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import { logger, REDACT_PATHS } from './logger';

describe('logger', () => {
  it('expose les méthodes pino habituelles', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it("censure les champs sensibles plutôt que de les écrire en clair (filet de sécurité)", () => {
    // Instance pino dédiée écrivant dans un flux en mémoire — mêmes
    // chemins de redact que le logger exporté (REDACT_PATHS), pour
    // vérifier le comportement réel de fast-redact sans dépendre du
    // timing d'écriture asynchrone de l'instance globale (sonic-boom).
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const testLogger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);

    testLogger.info({ email: 'ne-doit-jamais-apparaitre@example.invalid' }, 'test redact');

    const output = chunks.join('');
    expect(output).not.toContain('ne-doit-jamais-apparaitre@example.invalid');
    expect(output).toContain('[redacted]');
  });

  it('écrit sans lever d\'exception', () => {
    expect(() => logger.info({ tenantId: 'qa-test' }, 'test log')).not.toThrow();
  });
});
