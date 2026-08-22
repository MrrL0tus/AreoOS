'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Papa from 'papaparse';
import Link from 'next/link';
import { importAircraftCsv } from '@/lib/actions/aircraft-import';
import {
  AIRCRAFT_CSV_FIELDS,
  guessColumnMapping,
  mapCsvRow,
  buildTemplateCsv,
  emptyImportFormState,
  type ColumnMapping,
  type ImportFormState,
} from '@/lib/import/aircraft-csv';

type Step = 'upload' | 'mapping' | 'preview';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Import en cours…' : 'Importer'}
    </button>
  );
}

function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modele-import-actifs.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportWizard() {
  const [state, formAction] = useActionState<ImportFormState, FormData>(
    importAircraftCsv,
    emptyImportFormState
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParseError(null);
    if (!file) return;
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.meta.fields || result.meta.fields.length === 0) {
          setParseError('Impossible de détecter les colonnes du fichier');
          return;
        }
        if (result.data.length === 0) {
          setParseError('Le fichier ne contient aucune ligne de données');
          return;
        }
        setHeaders(result.meta.fields);
        setRows(result.data);
        setMapping(guessColumnMapping(result.meta.fields));
        setStep('mapping');
      },
      error: (err) => setParseError(err.message),
    });
  }

  const previewResults = rows
    .slice(0, 10)
    .map((row, i) => ({ line: i + 2, row, result: mapCsvRow(row, mapping) }));
  const missingRequired = AIRCRAFT_CSV_FIELDS.filter((f) => f.required && !mapping[f.key]);

  if (state.report) {
    const { report } = state;
    return (
      <div className="card">
        <div className="card-title">Résultat de l&apos;import</div>
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="kpi">
            <div className="kpi-label">Créés</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>{report.created}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Ignorés (déjà existants)</div>
            <div className="kpi-value">{report.skipped}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">En erreur</div>
            <div className="kpi-value" style={{ color: report.errors.length ? 'var(--red)' : undefined }}>
              {report.errors.length}
            </div>
          </div>
        </div>

        {report.errors.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Motif</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((e) => (
                  <tr key={e.line}>
                    <td className="mono">{e.line}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--red)' }}>{e.reasons.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <Link href="/assets" className="btn btn-primary">Voir le registre</Link>
          <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
            Nouvel import
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {state.formError && <div className="error-box">{state.formError}</div>}

      <div className="card">
        <div className="card-title">
          1. Déposer le fichier
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={downloadTemplate}>
            ↓ Télécharger le modèle CSV
          </button>
        </div>
        <div className="field">
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            required
          />
        </div>
        {parseError && <div className="error-box">{parseError}</div>}
        {fileName && step !== 'upload' && (
          <div className="field-hint">
            {fileName} — {rows.length} ligne(s) de données détectée(s)
          </div>
        )}
      </div>

      {(step === 'mapping' || step === 'preview') && (
        <div className="card">
          <div className="card-title">2. Correspondance des colonnes</div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
            Associez chaque champ AeroOS à une colonne du fichier. Les champs marqués * sont obligatoires.
          </p>
          <div className="field-row">
            {AIRCRAFT_CSV_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
                <select
                  id={`map-${f.key}`}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))
                  }
                >
                  <option value="">— non associé —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <div className="field-error">
              Champs obligatoires non associés :{' '}
              {missingRequired.map((f) => f.label).join(', ')}
            </div>
          )}
          {step === 'mapping' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={missingRequired.length > 0}
              onClick={() => setStep('preview')}
            >
              Prévisualiser
            </button>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="card">
          <div className="card-title">
            3. Aperçu ({Math.min(10, rows.length)} sur {rows.length} lignes)
          </div>
          <div className="table-wrap" style={{ marginBottom: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>MSN</th>
                  <th>Constructeur / Modèle</th>
                  <th>Année</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {previewResults.map(({ line, result }) => (
                  <tr key={line}>
                    <td className="mono">{line}</td>
                    {result.ok ? (
                      <>
                        <td className="mono">{result.data.msn}</td>
                        <td>{result.data.manufacturer} {result.data.model}</td>
                        <td className="mono">{result.data.yearBuilt}</td>
                        <td>
                          <span className="badge badge-green">Valide</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} style={{ color: 'var(--red)', fontSize: 11.5 }}>
                        {result.errors.join(' · ')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <div style={{ marginTop: 16 }}>
            <SubmitButton />
          </div>
        </div>
      )}
    </form>
  );
}
