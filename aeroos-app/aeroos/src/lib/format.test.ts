import { describe, it, expect } from 'vitest';
import {
  money, moneyCompact, num, pct, date, dateShort, daysUntil,
  aircraftLabel, assetStatus, paymentStatus, severityTone, initials,
} from './format';

describe('money', () => {
  it('formate un montant en devise', () => {
    expect(money(1234)).toContain('1');
    expect(money(1234)).toContain('234');
  });
  it('retourne — pour null/undefined', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
  it('mode compact abrège en k/M/Md', () => {
    expect(money(2_500_000_000, 'USD', { compact: true })).toContain('Md');
    expect(money(2_500_000, 'USD', { compact: true })).toContain('M');
    expect(money(2_500, 'USD', { compact: true })).toContain('k');
  });
});

describe('moneyCompact', () => {
  it('utilise le symbole € pour EUR et $ sinon', () => {
    expect(moneyCompact(1500, 'EUR')).toContain('€');
    expect(moneyCompact(1500, 'USD')).toContain('$');
  });
  it('gère les valeurs négatives', () => {
    expect(moneyCompact(-2_000_000)).toContain('-');
  });
  it('retourne — pour null', () => {
    expect(moneyCompact(null)).toBe('—');
  });
});

describe('num / pct', () => {
  it('num formate avec séparateurs de milliers, — si absent', () => {
    expect(num(1000)).not.toBe('1000');
    expect(num(null)).toBe('—');
  });
  it('pct convertit une fraction en pourcentage affiché', () => {
    expect(pct(0.756)).toBe('75.6 %');
    expect(pct(0.5, 0)).toBe('50 %');
    expect(pct(null)).toBe('—');
  });
});

describe('date / dateShort / daysUntil', () => {
  it('date accepte Date ou string ISO, — si absent', () => {
    expect(date(new Date('2026-03-15'))).not.toBe('—');
    expect(date('2026-03-15')).not.toBe('—');
    expect(date(null)).toBe('—');
  });
  it('daysUntil calcule un delta en jours signé', () => {
    const future = new Date(Date.now() + 10 * 86400000);
    const past = new Date(Date.now() - 5 * 86400000);
    expect(daysUntil(future)).toBeGreaterThan(0);
    expect(daysUntil(past)).toBeLessThan(0);
    expect(daysUntil(null)).toBeNull();
  });
  it('dateShort n\'inclut pas le jour', () => {
    const s = dateShort(new Date('2026-03-15'));
    expect(s).not.toBe('—');
  });
});

describe('aircraftLabel', () => {
  it('concatène modèle et variante', () => {
    expect(aircraftLabel({ model: 'A320', variant: 'neo' })).toBe('A320neo');
  });
  it('gère une variante absente', () => {
    expect(aircraftLabel({ model: 'B737', variant: null })).toBe('B737');
  });
});

describe('assetStatus / paymentStatus / severityTone', () => {
  it('mappe un statut connu vers un libellé français', () => {
    expect(assetStatus('ON_LEASE').label).toBe('Loué');
    expect(paymentStatus('OVERDUE').label).toBe('En retard');
  });
  it('retombe sur le code brut pour un statut inconnu', () => {
    expect(assetStatus('WHATEVER').label).toBe('WHATEVER');
    expect(paymentStatus('WHATEVER').tone).toBe('gray');
  });
  it('severityTone mappe CRITICAL/HIGH/MEDIUM/LOW/INFO et défaut', () => {
    expect(severityTone('CRITICAL')).toBe('critical');
    expect(severityTone('INFO')).toBe('low');
    expect(severityTone('UNKNOWN')).toBe('low');
  });
});

describe('initials', () => {
  it('prend la première lettre de chaque prénom/nom, en majuscule', () => {
    expect(initials('claire', 'fontaine')).toBe('CF');
  });
  it('tolère une chaîne vide', () => {
    expect(initials('', 'Dupont')).toBe('D');
  });
});
