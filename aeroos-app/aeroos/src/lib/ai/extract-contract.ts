/**
 * AeroOS — Pipeline d'extraction de contrat (IA)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Garde-fous obligatoires (Cahier de conformité §1.1 contexte 3) :
 *  - Ne touche jamais LeaseContract — se contente de produire des champs
 *    candidats, stockés en AiExtraction avec statut PENDING (cf.
 *    lib/actions/ai-validation.ts pour l'écriture, validée par un humain).
 *  - Trace modelName/modelVersion/promptVersion sur chaque extraction.
 *  - N'invente pas de valeur : un champ absent du contrat doit rester
 *    `null`, jamais une supposition.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const MODEL_NAME = 'claude-opus-5';
export const PROMPT_VERSION = 'contract-extraction-v1';

function extractedField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
    sourcePage: z.number().int().nullable(),
  });
}

export const contractExtractionSchema = z.object({
  // Parties
  lessorName: extractedField(z.string()),
  lesseeName: extractedField(z.string()),
  msn: extractedField(z.string()),
  registration: extractedField(z.string()),
  aircraftType: extractedField(z.string()),
  // Dates
  startDate: extractedField(z.string()),
  endDate: extractedField(z.string()),
  deliveryDate: extractedField(z.string()),
  signedDate: extractedField(z.string()),
  // Financier
  monthlyRent: extractedField(z.number()),
  currency: extractedField(z.string()),
  escalationClause: extractedField(z.string()),
  securityDeposit: extractedField(z.number()),
  mrEngine: extractedField(z.number()),
  mrApu: extractedField(z.number()),
  // Juridique
  governingLaw: extractedField(z.string()),
  hasPurchaseOption: extractedField(z.boolean()),
  sanctionsClause: extractedField(z.boolean()),
});

export type ContractExtractionFields = z.infer<typeof contractExtractionSchema>;

// JSON Schema brut envoyé à l'API (plutôt que le helper zodOutputFormat,
// qui exige zod v4 en interne — ce projet est sur zod v3 partout
// ailleurs). La réponse est re-validée avec contractExtractionSchema
// ci-dessus, donc la garantie de type est la même.
function fieldJsonSchema(valueType: 'string' | 'number' | 'boolean') {
  return {
    type: 'object',
    properties: {
      value: { type: [valueType, 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      sourcePage: { type: ['integer', 'null'] },
    },
    required: ['value', 'confidence', 'sourcePage'],
    additionalProperties: false,
  };
}

const STRING_FIELDS = [
  'lessorName', 'lesseeName', 'msn', 'registration', 'aircraftType',
  'startDate', 'endDate', 'deliveryDate', 'signedDate',
  'currency', 'escalationClause', 'governingLaw',
] as const;
const NUMBER_FIELDS = ['monthlyRent', 'securityDeposit', 'mrEngine', 'mrApu'] as const;
const BOOLEAN_FIELDS = ['hasPurchaseOption', 'sanctionsClause'] as const;

const CONTRACT_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(STRING_FIELDS.map((k) => [k, fieldJsonSchema('string')])),
    ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, fieldJsonSchema('number')])),
    ...Object.fromEntries(BOOLEAN_FIELDS.map((k) => [k, fieldJsonSchema('boolean')])),
  },
  required: [...STRING_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Tu extrais des données structurées d'un contrat de leasing aéronautique pour AeroOS, une plateforme de gestion d'actifs.

Règles impératives :
- N'invente jamais de valeur. Si un champ n'apparaît pas explicitement dans le texte, retourne value: null et confidence: 0.
- confidence reflète ta certitude que la valeur extraite est exacte (0 à 1), pas la présence du champ.
- Le texte fourni contient des marqueurs de page au format "-- N of M --" insérés entre les pages du PDF source. Utilise-les pour renseigner sourcePage (le numéro N de la page où l'information apparaît). Si tu ne peux pas déterminer la page, mets sourcePage: null.
- Pour les montants (monthlyRent, securityDeposit, mrEngine, mrApu) : extrait uniquement le nombre, sans symbole monétaire ni séparateur de milliers.
- Pour les dates (startDate, endDate, deliveryDate, signedDate) : format ISO YYYY-MM-DD.
- sanctionsClause : true si le contrat contient une clause de sanctions économiques / conformité OFAC / entités désignées, même mentionnée brièvement. En cas de doute, réponds true — un faux négatif ici est plus grave qu'un faux positif (cf. Cahier de conformité §5.4 : révision humaine obligatoire pour toute clause de sanctions détectée, quelle que soit la confiance).
- hasPurchaseOption : true si le contrat mentionne une option d'achat pour le locataire.`;

export interface ContractExtractionResult {
  fields: ContractExtractionFields;
  overallConfidence: number;
  modelName: string;
  modelVersion: string | null;
  promptVersion: string;
}

/**
 * Appelle Claude pour extraire les 18 champs d'un contrat à partir du
 * texte déjà extrait du PDF (cf. lib/pdf-extract.ts, appelé à l'upload).
 * Ne touche jamais la base — l'appelant décide de la persistance.
 */
export async function extractContractFields(
  documentText: string
): Promise<ContractExtractionResult> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: MODEL_NAME,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: documentText }],
    output_config: {
      format: { type: 'json_schema', schema: CONTRACT_EXTRACTION_JSON_SCHEMA },
    },
  });

  const parsed = contractExtractionSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error('Extraction IA : sortie non structurée (échec du parsing)');
  }
  const fields = parsed.data;

  const confidences = Object.values(fields).map((f) => f.confidence);
  const overallConfidence =
    confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

  return {
    fields,
    overallConfidence,
    modelName: MODEL_NAME,
    modelVersion: response.model,
    promptVersion: PROMPT_VERSION,
  };
}
