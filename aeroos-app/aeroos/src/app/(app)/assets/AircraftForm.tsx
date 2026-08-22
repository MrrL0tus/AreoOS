'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { AssetStatus } from '@prisma/client';
import { assetStatus } from '@/lib/format';
import { createAircraft, updateAircraft } from '@/lib/actions/aircraft';
import {
  emptyAircraftFormState,
  type AircraftFormState,
} from '@/lib/validation/aircraft';

export interface AircraftFormValues {
  msn: string;
  registration: string | null;
  manufacturer: string;
  model: string;
  variant: string | null;
  yearBuilt: number;
  status: string;
  totalHours: number;
  totalCycles: number;
  cabinConfig: string | null;
  seatCount: number | null;
  mtowKg: number | null;
  cofaExpiryDate: Date | null;
  insuranceExpiryDate: Date | null;
}

function toDateInputValue(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function AircraftForm({
  mode,
  aircraftId,
  initialValues,
}: {
  mode: 'create' | 'edit';
  aircraftId?: string;
  initialValues?: AircraftFormValues;
}) {
  const action =
    mode === 'create' ? createAircraft : updateAircraft.bind(null, aircraftId!);
  const [state, formAction] = useActionState<AircraftFormState, FormData>(
    action,
    emptyAircraftFormState
  );

  const [hours, setHours] = useState(initialValues?.totalHours ?? 0);
  const [cycles, setCycles] = useState(initialValues?.totalCycles ?? 0);

  const err = state.errors;

  // Après une soumission refusée (erreur de validation ou métier), React
  // réinitialise les champs non contrôlés du <form> — on rejoue donc les
  // valeurs soumises (state.values) en priorité sur celles de la base,
  // pour ne pas faire perdre à l'utilisateur ce qu'il vient de taper.
  function dv(field: string, fallback: string | number | undefined): string | number {
    return state.values?.[field] ?? fallback ?? '';
  }

  return (
    // key : force un remontage après chaque soumission refusée — voir la
    // même astuce dans ContractForm.tsx (defaultValue d'un <select> non
    // réappliqué par un reset natif de <form>).
    <form key={JSON.stringify(state)} action={formAction}>
      {state.formError && <div className="error-box">{state.formError}</div>}

      <div className="card">
        <div className="card-title">Identité de l&apos;actif</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="msn">MSN</label>
            <input
              id="msn" name="msn" className="input" type="text"
              defaultValue={dv('msn', initialValues?.msn)} required
            />
            {err.msn && <div className="field-error">{err.msn}</div>}
          </div>
          <div className="field">
            <label htmlFor="registration">Immatriculation</label>
            <input
              id="registration" name="registration" className="input" type="text"
              defaultValue={dv('registration', initialValues?.registration ?? '')}
            />
            {err.registration && <div className="field-error">{err.registration}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="manufacturer">Constructeur</label>
            <input
              id="manufacturer" name="manufacturer" className="input" type="text"
              defaultValue={dv('manufacturer', initialValues?.manufacturer)} required
              placeholder="Airbus, Boeing, Embraer…"
            />
            {err.manufacturer && <div className="field-error">{err.manufacturer}</div>}
          </div>
          <div className="field">
            <label htmlFor="model">Modèle</label>
            <input
              id="model" name="model" className="input" type="text"
              defaultValue={dv('model', initialValues?.model)} required
              placeholder="A320, B737…"
            />
            {err.model && <div className="field-error">{err.model}</div>}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="variant">Variante</label>
            <input
              id="variant" name="variant" className="input" type="text"
              defaultValue={dv('variant', initialValues?.variant ?? '')}
              placeholder="-200, -800, neo…"
            />
            {err.variant && <div className="field-error">{err.variant}</div>}
          </div>
          <div className="field">
            <label htmlFor="yearBuilt">Année de construction</label>
            <input
              id="yearBuilt" name="yearBuilt" className="input" type="number"
              defaultValue={dv('yearBuilt', initialValues?.yearBuilt)} required
            />
            {err.yearBuilt && <div className="field-error">{err.yearBuilt}</div>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="status">Statut</label>
          <select
            id="status" name="status"
            defaultValue={dv('status', initialValues?.status ?? 'OFF_LEASE')}
            required
          >
            {Object.values(AssetStatus).map((s) => (
              <option key={s} value={s}>
                {assetStatus(s).label}
              </option>
            ))}
          </select>
          {err.status && <div className="field-error">{err.status}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Utilisation &amp; configuration</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="totalHours">Heures de vol (FH)</label>
            <input
              id="totalHours" name="totalHours" className="input" type="number" min={0}
              defaultValue={dv('totalHours', initialValues?.totalHours ?? '')}
              onChange={(e) => setHours(Number(e.target.value) || 0)}
            />
            {err.totalHours && <div className="field-error">{err.totalHours}</div>}
          </div>
          <div className="field">
            <label htmlFor="totalCycles">Cycles (FC)</label>
            <input
              id="totalCycles" name="totalCycles" className="input" type="number" min={0}
              defaultValue={dv('totalCycles', initialValues?.totalCycles ?? '')}
              onChange={(e) => setCycles(Number(e.target.value) || 0)}
            />
            {err.totalCycles && <div className="field-error">{err.totalCycles}</div>}
            {cycles > hours && hours > 0 && (
              <div className="field-hint" style={{ color: 'var(--amber)' }}>
                Les cycles dépassent les heures de vol — vérifiez la saisie.
              </div>
            )}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="cabinConfig">Configuration cabine</label>
            <input
              id="cabinConfig" name="cabinConfig" className="input" type="text"
              defaultValue={dv('cabinConfig', initialValues?.cabinConfig ?? '')}
              placeholder="174Y ou 12J/150Y"
            />
            {err.cabinConfig && <div className="field-error">{err.cabinConfig}</div>}
          </div>
          <div className="field">
            <label htmlFor="seatCount">Nombre de sièges</label>
            <input
              id="seatCount" name="seatCount" className="input" type="number" min={0}
              defaultValue={dv('seatCount', initialValues?.seatCount ?? '')}
            />
            {err.seatCount && <div className="field-error">{err.seatCount}</div>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="mtowKg">MTOW (kg)</label>
          <input
            id="mtowKg" name="mtowKg" className="input" type="number" min={0}
            defaultValue={dv('mtowKg', initialValues?.mtowKg ?? '')}
          />
          {err.mtowKg && <div className="field-error">{err.mtowKg}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Navigabilité</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="cofaExpiryDate">Expiration CofA</label>
            <input
              id="cofaExpiryDate" name="cofaExpiryDate" className="input" type="date"
              defaultValue={dv('cofaExpiryDate', toDateInputValue(initialValues?.cofaExpiryDate))}
            />
            {err.cofaExpiryDate && <div className="field-error">{err.cofaExpiryDate}</div>}
          </div>
          <div className="field">
            <label htmlFor="insuranceExpiryDate">Expiration assurance</label>
            <input
              id="insuranceExpiryDate" name="insuranceExpiryDate" className="input" type="date"
              defaultValue={dv(
                'insuranceExpiryDate',
                toDateInputValue(initialValues?.insuranceExpiryDate)
              )}
            />
            {err.insuranceExpiryDate && (
              <div className="field-error">{err.insuranceExpiryDate}</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <SubmitButton
          label={mode === 'create' ? "Créer l'actif" : 'Enregistrer les modifications'}
          pendingLabel="Enregistrement…"
        />
        <Link
          href={aircraftId ? `/assets/${aircraftId}` : '/assets'}
          className="btn btn-ghost"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
