'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ContractStatus } from '@prisma/client';
import { validateExtraction, rejectExtraction } from '@/lib/actions/ai-validation';
import { emptyContractFormState, type ContractFormState } from '@/lib/validation/contract';
import { date } from '@/lib/format';

interface ExtractedField {
  value?: unknown;
  confidence?: number;
  sourcePage?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  NEGOTIATION: 'Négociation',
  SIGNED: 'Signé',
  ACTIVE: 'Actif',
  REDELIVERY: 'Restitution',
  TERMINATED: 'Résilié',
  EXPIRED: 'Expiré',
};

function toDateInputValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function confBadge(field: ExtractedField | undefined) {
  const conf = field?.confidence ?? 0;
  const low = conf < 0.85;
  return (
    <span
      className="mono"
      style={{ fontSize: 10, color: low ? 'var(--amber)' : 'var(--green)', marginLeft: 8 }}
    >
      {Math.round(conf * 100)} %{low ? ' · à vérifier' : ''}
    </span>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Enregistrement…' : '✓ Valider et enregistrer'}
    </button>
  );
}

export default function ExtractionCard({
  extractionId,
  documentTitle,
  modelLabel,
  createdAt,
  overallConfidence,
  fields,
  aircraftOptions,
  operatorOptions,
  initialAircraftId,
  initialLesseeId,
}: {
  extractionId: string;
  documentTitle: string;
  modelLabel: string;
  createdAt: Date;
  overallConfidence: number;
  fields: Record<string, ExtractedField>;
  aircraftOptions: { id: string; msn: string }[];
  operatorOptions: { id: string; name: string; sanctionsStatus: string }[];
  initialAircraftId: string;
  initialLesseeId: string;
}) {
  const router = useRouter();
  const action = validateExtraction.bind(null, extractionId);
  const [state, formAction] = useActionState<ContractFormState, FormData>(
    action,
    emptyContractFormState
  );
  const err = state.errors;

  const [rejecting, startRejectTransition] = useTransition();
  const [rejectError, setRejectError] = useState<string | null>(null);

  function dv(field: string, fallback: string | number = ''): string | number {
    return state.values?.[field] ?? fallback;
  }

  function handleReject() {
    setRejectError(null);
    startRejectTransition(async () => {
      const result = await rejectExtraction(extractionId);
      if (!result.ok) {
        setRejectError(result.error ?? 'Échec du rejet');
        return;
      }
      router.refresh();
    });
  }

  const g = (key: string) => fields[key];
  const sanctionsFlagged = Boolean(g('sanctionsClause')?.value);

  return (
    <div className="card">
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
          paddingBottom: 10, borderBottom: '1px solid var(--border-2)',
        }}
      >
        <span className="badge badge-purple">◉ IA</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{documentTitle}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {modelLabel} · {date(createdAt)} · confiance globale{' '}
            {Math.round(overallConfidence * 100)} %
          </div>
        </div>
        <span className="badge badge-amber">À valider</span>
      </div>

      {sanctionsFlagged && (
        <div className="error-box">
          ⚠️ Clause de sanctions détectée par l&apos;IA — révision humaine
          obligatoire avant toute validation (cf. Cahier de conformité §5.4),
          quelle que soit la confiance affichée.
        </div>
      )}
      {state.formError && <div className="error-box">{state.formError}</div>}

      <form key={JSON.stringify(state)} action={formAction}>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`reference-${extractionId}`}>Référence</label>
            <input
              id={`reference-${extractionId}`} name="reference" className="input" type="text"
              defaultValue={dv('reference')} required placeholder="LC-2026-0042"
            />
            {err.reference && <div className="field-error">{err.reference}</div>}
          </div>
          <div className="field">
            <label htmlFor={`aircraftId-${extractionId}`}>
              Actif {g('msn')?.value ? `(IA : MSN ${String(g('msn')?.value)})` : ''}
            </label>
            <select id={`aircraftId-${extractionId}`} name="aircraftId" defaultValue={dv('aircraftId', initialAircraftId)} required>
              <option value="" disabled>Sélectionner un actif…</option>
              {aircraftOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.msn}</option>
              ))}
            </select>
            {err.aircraftId && <div className="field-error">{err.aircraftId}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`lessorName-${extractionId}`}>
              Bailleur{confBadge(g('lessorName'))}
            </label>
            <input
              id={`lessorName-${extractionId}`} name="lessorName" className="input" type="text"
              defaultValue={dv('lessorName', String(g('lessorName')?.value ?? ''))} required
            />
            {err.lessorName && <div className="field-error">{err.lessorName}</div>}
          </div>
          <div className="field">
            <label htmlFor={`lesseeId-${extractionId}`}>
              Locataire {g('lesseeName')?.value ? `(IA : ${String(g('lesseeName')?.value)})` : ''}
            </label>
            <select id={`lesseeId-${extractionId}`} name="lesseeId" defaultValue={dv('lesseeId', initialLesseeId)} required>
              <option value="" disabled>Sélectionner un locataire…</option>
              {operatorOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.sanctionsStatus === 'BLOCKED' ? ' — bloqué (sanctions)' : ''}
                  {o.sanctionsStatus === 'FLAGGED' ? ' — signalé (sanctions)' : ''}
                </option>
              ))}
            </select>
            {err.lesseeId && <div className="field-error">{err.lesseeId}</div>}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`status-${extractionId}`}>Statut initial</label>
          <select id={`status-${extractionId}`} name="status" defaultValue={dv('status', 'DRAFT')} required>
            {Object.values(ContractStatus).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
            ))}
          </select>
          {err.status && <div className="field-error">{err.status}</div>}
          <div className="field-hint">
            Statut « Actif » : génère les échéances mensuelles et met l&apos;actif en location.
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`startDate-${extractionId}`}>
              Début{confBadge(g('startDate'))}
            </label>
            <input
              id={`startDate-${extractionId}`} name="startDate" className="input" type="date"
              defaultValue={dv('startDate', toDateInputValue(g('startDate')?.value))} required
            />
            {err.startDate && <div className="field-error">{err.startDate}</div>}
          </div>
          <div className="field">
            <label htmlFor={`endDate-${extractionId}`}>
              Fin{confBadge(g('endDate'))}
            </label>
            <input
              id={`endDate-${extractionId}`} name="endDate" className="input" type="date"
              defaultValue={dv('endDate', toDateInputValue(g('endDate')?.value))} required
            />
            {err.endDate && <div className="field-error">{err.endDate}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`signedDate-${extractionId}`}>
              Signature{confBadge(g('signedDate'))}
            </label>
            <input
              id={`signedDate-${extractionId}`} name="signedDate" className="input" type="date"
              defaultValue={dv('signedDate', toDateInputValue(g('signedDate')?.value))}
            />
          </div>
          <div className="field">
            <label htmlFor={`deliveryDate-${extractionId}`}>
              Livraison{confBadge(g('deliveryDate'))}
            </label>
            <input
              id={`deliveryDate-${extractionId}`} name="deliveryDate" className="input" type="date"
              defaultValue={dv('deliveryDate', toDateInputValue(g('deliveryDate')?.value))}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`currency-${extractionId}`}>
              Devise{confBadge(g('currency'))}
            </label>
            <input
              id={`currency-${extractionId}`} name="currency" className="input" type="text" maxLength={3}
              defaultValue={dv('currency', String(g('currency')?.value ?? 'USD'))} required
            />
          </div>
          <div className="field">
            <label htmlFor={`monthlyRent-${extractionId}`}>
              Loyer mensuel{confBadge(g('monthlyRent'))}
            </label>
            <input
              id={`monthlyRent-${extractionId}`} name="monthlyRent" className="input" type="number" step="0.01" min={0}
              defaultValue={dv('monthlyRent', Number(g('monthlyRent')?.value ?? 0) || '')} required
            />
            {err.monthlyRent && <div className="field-error">{err.monthlyRent}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`securityDeposit-${extractionId}`}>
              Dépôt de garantie{confBadge(g('securityDeposit'))}
            </label>
            <input
              id={`securityDeposit-${extractionId}`} name="securityDeposit" className="input" type="number" step="0.01" min={0}
              defaultValue={dv('securityDeposit', g('securityDeposit')?.value != null ? Number(g('securityDeposit')?.value) : '')}
            />
          </div>
          <div className="field">
            <label htmlFor={`escalationClause-${extractionId}`}>
              Clause d&apos;indexation{confBadge(g('escalationClause'))}
            </label>
            <input
              id={`escalationClause-${extractionId}`} name="escalationClause" className="input" type="text"
              defaultValue={dv('escalationClause', String(g('escalationClause')?.value ?? ''))}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`mrEngineLeft-${extractionId}`}>
              MR moteur (gauche){confBadge(g('mrEngine'))}
            </label>
            <input
              id={`mrEngineLeft-${extractionId}`} name="mrEngineLeft" className="input" type="number" step="0.01" min={0}
              defaultValue={dv('mrEngineLeft', g('mrEngine')?.value != null ? Number(g('mrEngine')?.value) : '')}
            />
          </div>
          <div className="field">
            <label htmlFor={`mrEngineRight-${extractionId}`}>MR moteur (droit)</label>
            <input
              id={`mrEngineRight-${extractionId}`} name="mrEngineRight" className="input" type="number" step="0.01" min={0}
              defaultValue={dv('mrEngineRight', g('mrEngine')?.value != null ? Number(g('mrEngine')?.value) : '')}
            />
            <div className="field-hint">L&apos;IA n&apos;extrait qu&apos;un MR moteur unique — reporté sur les deux côtés.</div>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`mrApu-${extractionId}`}>
              MR APU{confBadge(g('mrApu'))}
            </label>
            <input
              id={`mrApu-${extractionId}`} name="mrApu" className="input" type="number" step="0.01" min={0}
              defaultValue={dv('mrApu', g('mrApu')?.value != null ? Number(g('mrApu')?.value) : '')}
            />
          </div>
          <div className="field">
            <label htmlFor={`governingLaw-${extractionId}`}>
              Droit applicable{confBadge(g('governingLaw'))}
            </label>
            <input
              id={`governingLaw-${extractionId}`} name="governingLaw" className="input" type="text"
              defaultValue={dv('governingLaw', String(g('governingLaw')?.value ?? ''))}
            />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 14 }}>
          <input
            type="checkbox" name="hasPurchaseOption"
            defaultChecked={
              state.values?.hasPurchaseOption
                ? state.values.hasPurchaseOption === 'on'
                : Boolean(g('hasPurchaseOption')?.value)
            }
          />
          Option d&apos;achat{confBadge(g('hasPurchaseOption'))}
        </label>

        {rejectError && <div className="error-box">{rejectError}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <SubmitButton />
          <button
            type="button" className="btn btn-ghost" style={{ color: 'var(--red)' }}
            onClick={handleReject} disabled={rejecting}
          >
            {rejecting ? 'Rejet…' : 'Rejeter'}
          </button>
        </div>
      </form>
    </div>
  );
}
