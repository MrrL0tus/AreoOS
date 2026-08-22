'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { recordPayment } from '@/lib/actions/payment';
import { emptyPaymentFormState, type PaymentFormState } from '@/lib/validation/payment';
import { money, date, daysUntil, paymentStatus } from '@/lib/format';

export interface PaymentRowData {
  id: string;
  periodLabel: string;
  dueDate: string;
  amountDue: number;
  currency: string;
  receivedDate: string | null;
  amountReceived: number | null;
  status: string;
  notes: string | null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Enregistrement…' : 'Confirmer'}
    </button>
  );
}

export default function PaymentRow({
  contractId,
  payment,
}: {
  contractId: string;
  payment: PaymentRowData;
}) {
  const [open, setOpen] = useState(false);
  const recordAction = recordPayment.bind(null, contractId, payment.id);
  const [state, formAction] = useActionState<PaymentFormState, FormData>(
    recordAction,
    emptyPaymentFormState
  );
  const err = state.errors;

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state]);

  const st = paymentStatus(payment.status);
  const late =
    payment.receivedDate && (payment.status === 'RECEIVED' || payment.status === 'PARTIAL')
      ? Math.round(
          (new Date(payment.receivedDate).getTime() - new Date(payment.dueDate).getTime()) /
            86400000
        )
      : null;
  const dueDays = daysUntil(payment.dueDate);
  const isOverdue =
    (payment.status === 'DUE' || payment.status === 'OVERDUE') && dueDays !== null && dueDays < 0;

  return (
    <>
      <tr>
        <td className="mono">{payment.periodLabel}</td>
        <td className="mono t2" style={{ fontSize: 11.5 }}>
          {date(payment.dueDate)}
        </td>
        <td className="mono">{money(payment.amountDue, payment.currency)}</td>
        <td className="mono t2" style={{ fontSize: 11.5 }}>
          {payment.amountReceived ? money(payment.amountReceived, payment.currency) : '—'}
          {late !== null && late > 0 && (
            <span style={{ color: 'var(--red)', marginLeft: 6 }}>+{late} j</span>
          )}
        </td>
        <td>
          <span className={`badge badge-${isOverdue ? 'red' : st.tone}`}>
            {isOverdue ? 'En retard' : st.label}
          </span>
        </td>
        <td>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setOpen((v) => !v)}
          >
            {payment.status === 'RECEIVED' ? 'Corriger' : 'Enregistrer'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
            <form
              key={JSON.stringify(state)}
              action={formAction}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-end',
                flexWrap: 'wrap', padding: '10px 4px',
              }}
            >
              {state.formError && (
                <div className="error-box" style={{ width: '100%' }}>
                  {state.formError}
                </div>
              )}
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`amountReceived-${payment.id}`}>Montant reçu</label>
                <input
                  id={`amountReceived-${payment.id}`}
                  name="amountReceived"
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={payment.amountReceived ?? payment.amountDue}
                  style={{ width: 140 }}
                  required
                />
                {err.amountReceived && <div className="field-error">{err.amountReceived}</div>}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`receivedDate-${payment.id}`}>Date de réception</label>
                <input
                  id={`receivedDate-${payment.id}`}
                  name="receivedDate"
                  className="input"
                  type="date"
                  defaultValue={
                    payment.receivedDate
                      ? payment.receivedDate.slice(0, 10)
                      : new Date().toISOString().slice(0, 10)
                  }
                  style={{ width: 160 }}
                  required
                />
                {err.receivedDate && <div className="field-error">{err.receivedDate}</div>}
              </div>
              <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
                <label htmlFor={`notes-${payment.id}`}>
                  Notes{payment.status === 'RECEIVED' ? ' (justification requise)' : ' (optionnel)'}
                </label>
                <input
                  id={`notes-${payment.id}`}
                  name="notes"
                  className="input"
                  type="text"
                  defaultValue={payment.notes ?? ''}
                  required={payment.status === 'RECEIVED'}
                />
                {err.notes && <div className="field-error">{err.notes}</div>}
              </div>
              <SubmitButton />
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Annuler
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
