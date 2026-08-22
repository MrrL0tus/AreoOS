'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { ContractStatus } from '@prisma/client';
import { createContract } from '@/lib/actions/contract';
import {
  emptyContractFormState,
  type ContractFormState,
} from '@/lib/validation/contract';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  NEGOTIATION: 'Négociation',
  SIGNED: 'Signé',
  ACTIVE: 'Actif',
  REDELIVERY: 'Restitution',
  TERMINATED: 'Résilié',
  EXPIRED: 'Expiré',
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Enregistrement…' : 'Créer le contrat'}
    </button>
  );
}

export default function ContractForm({
  aircraftOptions,
  operatorOptions,
  defaultLessorName,
}: {
  aircraftOptions: { id: string; msn: string; label: string }[];
  operatorOptions: { id: string; name: string; sanctionsStatus: string }[];
  defaultLessorName: string;
}) {
  const [state, formAction] = useActionState<ContractFormState, FormData>(
    createContract,
    emptyContractFormState
  );
  const err = state.errors;

  function dv(field: string, fallback: string | number | undefined = ''): string | number {
    return state.values?.[field] ?? fallback;
  }

  return (
    // key : force un remontage après chaque soumission refusée. React ne
    // réapplique defaultValue sur un <select> qu'au montage — sans ce
    // remontage, le reset natif du <form> (déclenché après toute action
    // non-redirigeante) rétablirait la sélection d'origine, pas la valeur
    // qui vient d'être soumise.
    <form key={JSON.stringify(state)} action={formAction}>
      {state.formError && <div className="error-box">{state.formError}</div>}

      <div className="card">
        <div className="card-title">Parties &amp; actif</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="reference">Référence</label>
            <input
              id="reference" name="reference" className="input" type="text"
              defaultValue={dv('reference')} required placeholder="LC-2026-0042"
            />
            {err.reference && <div className="field-error">{err.reference}</div>}
          </div>
          <div className="field">
            <label htmlFor="aircraftId">Actif</label>
            <select id="aircraftId" name="aircraftId" defaultValue={dv('aircraftId')} required>
              <option value="" disabled>
                Sélectionner un actif…
              </option>
              {aircraftOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.msn} — {a.label}
                </option>
              ))}
            </select>
            {err.aircraftId && <div className="field-error">{err.aircraftId}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="lessorName">Bailleur</label>
            <input
              id="lessorName" name="lessorName" className="input" type="text"
              defaultValue={dv('lessorName', defaultLessorName)} required
            />
            {err.lessorName && <div className="field-error">{err.lessorName}</div>}
          </div>
          <div className="field">
            <label htmlFor="lesseeId">Locataire</label>
            <select id="lesseeId" name="lesseeId" defaultValue={dv('lesseeId')} required>
              <option value="" disabled>
                Sélectionner un locataire…
              </option>
              {operatorOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.sanctionsStatus === 'BLOCKED' ? ' — bloqué (sanctions)' : ''}
                  {o.sanctionsStatus === 'FLAGGED' ? ' — signalé (sanctions)' : ''}
                </option>
              ))}
            </select>
            {err.lesseeId && <div className="field-error">{err.lesseeId}</div>}
            <div className="field-hint">
              Un locataire bloqué pour sanctions empêchera la création du contrat.
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="status">Statut initial</label>
          <select id="status" name="status" defaultValue={dv('status', 'DRAFT')} required>
            {Object.values(ContractStatus).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>
          {err.status && <div className="field-error">{err.status}</div>}
          <div className="field-hint">
            Statut « Actif » : génère les échéances mensuelles et met l&apos;actif en location.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Dates</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="startDate">Début</label>
            <input
              id="startDate" name="startDate" className="input" type="date"
              defaultValue={dv('startDate')} required
            />
            {err.startDate && <div className="field-error">{err.startDate}</div>}
          </div>
          <div className="field">
            <label htmlFor="endDate">Fin</label>
            <input
              id="endDate" name="endDate" className="input" type="date"
              defaultValue={dv('endDate')} required
            />
            {err.endDate && <div className="field-error">{err.endDate}</div>}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="signedDate">Date de signature</label>
            <input
              id="signedDate" name="signedDate" className="input" type="date"
              defaultValue={dv('signedDate')}
            />
            {err.signedDate && <div className="field-error">{err.signedDate}</div>}
          </div>
          <div className="field">
            <label htmlFor="deliveryDate">Date de livraison</label>
            <input
              id="deliveryDate" name="deliveryDate" className="input" type="date"
              defaultValue={dv('deliveryDate')}
            />
            {err.deliveryDate && <div className="field-error">{err.deliveryDate}</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Conditions financières</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="currency">Devise</label>
            <input
              id="currency" name="currency" className="input" type="text"
              defaultValue={dv('currency', 'USD')} required maxLength={3}
              style={{ textTransform: 'uppercase' }}
            />
            {err.currency && <div className="field-error">{err.currency}</div>}
          </div>
          <div className="field">
            <label htmlFor="monthlyRent">Loyer mensuel</label>
            <input
              id="monthlyRent" name="monthlyRent" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('monthlyRent')} required
            />
            {err.monthlyRent && <div className="field-error">{err.monthlyRent}</div>}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="securityDeposit">Dépôt de garantie</label>
            <input
              id="securityDeposit" name="securityDeposit" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('securityDeposit')}
            />
            {err.securityDeposit && <div className="field-error">{err.securityDeposit}</div>}
          </div>
          <div className="field">
            <label htmlFor="escalationClause">Clause d&apos;indexation</label>
            <input
              id="escalationClause" name="escalationClause" className="input" type="text"
              defaultValue={dv('escalationClause')} placeholder="SOFR + 1.85%"
            />
            {err.escalationClause && <div className="field-error">{err.escalationClause}</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Maintenance Reserves</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mrEngineLeft">MR moteur gauche</label>
            <input
              id="mrEngineLeft" name="mrEngineLeft" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('mrEngineLeft')}
            />
            {err.mrEngineLeft && <div className="field-error">{err.mrEngineLeft}</div>}
          </div>
          <div className="field">
            <label htmlFor="mrEngineRight">MR moteur droit</label>
            <input
              id="mrEngineRight" name="mrEngineRight" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('mrEngineRight')}
            />
            {err.mrEngineRight && <div className="field-error">{err.mrEngineRight}</div>}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mrApu">MR APU</label>
            <input
              id="mrApu" name="mrApu" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('mrApu')}
            />
            {err.mrApu && <div className="field-error">{err.mrApu}</div>}
          </div>
          <div className="field">
            <label htmlFor="mrLandingGear">MR train d&apos;atterrissage</label>
            <input
              id="mrLandingGear" name="mrLandingGear" className="input" type="number"
              min={0} step="0.01" defaultValue={dv('mrLandingGear')}
            />
            {err.mrLandingGear && <div className="field-error">{err.mrLandingGear}</div>}
          </div>
        </div>
        <div className="field">
          <label htmlFor="mrAirframe">MR cellule</label>
          <input
            id="mrAirframe" name="mrAirframe" className="input" type="number"
            min={0} step="0.01" defaultValue={dv('mrAirframe')}
          />
          {err.mrAirframe && <div className="field-error">{err.mrAirframe}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Juridique &amp; clauses</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="governingLaw">Droit applicable</label>
            <input
              id="governingLaw" name="governingLaw" className="input" type="text"
              defaultValue={dv('governingLaw')} placeholder="Irish law, New York law…"
            />
            {err.governingLaw && <div className="field-error">{err.governingLaw}</div>}
          </div>
          <div className="field">
            <label htmlFor="jurisdiction">Juridiction</label>
            <input
              id="jurisdiction" name="jurisdiction" className="input" type="text"
              defaultValue={dv('jurisdiction')}
            />
            {err.jurisdiction && <div className="field-error">{err.jurisdiction}</div>}
          </div>
        </div>

        <div className="field-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox" name="hasPurchaseOption"
              defaultChecked={state.values?.hasPurchaseOption === 'on'}
            />
            Option d&apos;achat
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox" name="hasExtensionOption"
              defaultChecked={state.values?.hasExtensionOption === 'on'}
            />
            Option d&apos;extension
          </label>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox" name="hasEarlyTermination"
              defaultChecked={state.values?.hasEarlyTermination === 'on'}
            />
            Résiliation anticipée possible
          </label>
        </div>

        <div className="field">
          <label htmlFor="returnConditions">Return conditions</label>
          <textarea
            id="returnConditions" name="returnConditions" rows={3}
            defaultValue={dv('returnConditions')}
          />
          {err.returnConditions && <div className="field-error">{err.returnConditions}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <SubmitButton />
        <Link href="/contracts" className="btn btn-ghost">
          Annuler
        </Link>
      </div>
    </form>
  );
}
