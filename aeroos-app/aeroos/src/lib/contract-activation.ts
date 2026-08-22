/**
 * Logique d'activation de contrat partagée entre la création manuelle
 * (lib/actions/contract.ts, T2.2) et la validation d'extraction IA
 * (lib/actions/ai-validation.ts, T3.2) — un contrat passé au statut
 * ACTIVE déclenche toujours les mêmes effets : échéancier généré, actif
 * mis en location.
 */

export interface MonthlyPaymentPlan {
  periodLabel: string;
  dueDate: Date;
  amountDue: number;
  currency: string;
}

/**
 * Une échéance par mois calendaire couvert par le contrat, due le 1er de
 * chaque mois — même convention que prisma/seed.ts.
 */
export function buildMonthlyPayments(params: {
  startDate: Date;
  endDate: Date;
  monthlyRent: number;
  currency: string;
}): MonthlyPaymentPlan[] {
  const payments: MonthlyPaymentPlan[] = [];

  const cursor = new Date(params.startDate.getFullYear(), params.startDate.getMonth(), 1);
  const last = new Date(params.endDate.getFullYear(), params.endDate.getMonth(), 1);

  while (cursor <= last) {
    payments.push({
      periodLabel: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      dueDate: new Date(cursor),
      amountDue: params.monthlyRent,
      currency: params.currency,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return payments;
}
