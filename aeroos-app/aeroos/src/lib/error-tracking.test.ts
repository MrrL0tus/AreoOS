import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentryInit = vi.fn();
const sentryCapture = vi.fn();

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => sentryInit(...args),
  captureException: (...args: unknown[]) => sentryCapture(...args),
}));

describe('captureException', () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    sentryInit.mockClear();
    sentryCapture.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it("sans SENTRY_DSN, ne lève pas et n'appelle jamais Sentry (log structuré seul)", async () => {
    delete process.env.SENTRY_DSN;
    const { captureException } = await import('./error-tracking');

    expect(() => captureException(new Error('boum'), { tenantId: 't1' })).not.toThrow();
    expect(sentryInit).not.toHaveBeenCalled();
    expect(sentryCapture).not.toHaveBeenCalled();
  });

  it('avec SENTRY_DSN, initialise Sentry une seule fois puis capture les erreurs suivantes', async () => {
    process.env.SENTRY_DSN = 'https://qa@example.invalid/1';
    const { captureException } = await import('./error-tracking');

    captureException(new Error('premier'), { tenantId: 't1' });
    captureException(new Error('second'), { tenantId: 't2' });

    expect(sentryInit).toHaveBeenCalledTimes(1);
    expect(sentryCapture).toHaveBeenCalledTimes(2);
  });

  it('convertit une valeur non-Error en Error avant capture', async () => {
    delete process.env.SENTRY_DSN;
    const { captureException } = await import('./error-tracking');
    expect(() => captureException('juste une chaîne')).not.toThrow();
  });
});
