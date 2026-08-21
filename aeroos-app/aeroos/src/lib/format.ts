/**
 * AeroOS — Formatage d'affichage
 * Centralisé pour garantir la cohérence entre tous les écrans.
 */

export function money(
  value: number | null | undefined,
  currency = 'USD',
  opts: { compact?: boolean } = {}
): string {
  if (value == null) return '—';

  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${sign(value)}${(abs / 1e9).toFixed(2)} Md`;
    if (abs >= 1_000_000) return `${sign(value)}${(abs / 1e6).toFixed(1)} M`;
    if (abs >= 1_000) return `${sign(value)}${(abs / 1e3).toFixed(0)} k`;
  }

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function moneyCompact(value: number | null | undefined, currency = 'USD'): string {
  if (value == null) return '—';
  const symbol = currency === 'EUR' ? '€' : '$';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}Md`;
  if (abs >= 1e6) return `${symbol}${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${symbol}${(value / 1e3).toFixed(0)}k`;
  return `${symbol}${value.toFixed(0)}`;
}

function sign(v: number): string {
  return v < 0 ? '-' : '';
}

export function num(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('fr-FR').format(value);
}

/**
 * Formate une fraction (0.75) en pourcentage affiché ("75.0 %").
 */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(digits)} %`;
}

export function date(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(dt);
}

export function dateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'short', year: '2-digit',
  }).format(dt);
}

export function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

export function aircraftLabel(a: {
  manufacturer?: string; model: string; variant?: string | null;
}): string {
  return `${a.model}${a.variant ?? ''}`;
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  ON_LEASE:       { label: 'Loué',           tone: 'green' },
  OFF_LEASE:      { label: 'Disponible',     tone: 'gray' },
  IN_TRANSITION:  { label: 'Transition',     tone: 'amber' },
  IN_MAINTENANCE: { label: 'Maintenance',    tone: 'purple' },
  STORED:         { label: 'Stocké',         tone: 'gray' },
  SOLD:           { label: 'Vendu',          tone: 'gray' },
  PARTED_OUT:     { label: 'Démantelé',      tone: 'gray' },
};

export function assetStatus(s: string): { label: string; tone: string } {
  return STATUS_LABELS[s] ?? { label: s, tone: 'gray' };
}

const PAYMENT_LABELS: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: 'Prévu',      tone: 'gray' },
  DUE:       { label: 'Échu',       tone: 'amber' },
  RECEIVED:  { label: 'Reçu',       tone: 'green' },
  PARTIAL:   { label: 'Partiel',    tone: 'amber' },
  OVERDUE:   { label: 'En retard',  tone: 'red' },
  WAIVED:    { label: 'Annulé',     tone: 'gray' },
};

export function paymentStatus(s: string): { label: string; tone: string } {
  return PAYMENT_LABELS[s] ?? { label: s, tone: 'gray' };
}

export function severityTone(s: string): string {
  return { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'low' }[s] ?? 'low';
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}
