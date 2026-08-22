/**
 * AeroOS — Résumé de rapport technique (T3.3)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Condense un rapport technique (shop visit, inspection...) en une
 * fiche d'une page. Garde-fou obligatoire (Cahier de conformité §7 D5) :
 * toute donnée chiffrée issue d'un résumé est ESTIMATED — jamais une
 * source pour un calcul réglementaire. L'appelant doit afficher cette
 * mention (cf. classe CSS .disclaimer) partout où ce résumé apparaît.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const MODEL_NAME = 'claude-opus-5';

const engineConditionSchema = z.object({
  engine: z.string(),
  egtMargin: z.string().nullable(),
  llpCyclesRemaining: z.number().int().nullable(),
});

const costLineSchema = z.object({
  category: z.string(),
  amount: z.number().nullable(),
});

export const reportSummarySchema = z.object({
  overallResult: z.string(),
  engineCondition: z.array(engineConditionSchema),
  adCompleted: z.number().int().nullable(),
  adRemaining: z.number().int().nullable(),
  costBreakdown: z.array(costLineSchema),
  totalCost: z.number().nullable(),
  currency: z.string().nullable(),
  nextMilestoneDescription: z.string().nullable(),
  nextMilestoneEstimatedDate: z.string().nullable(),
});

export type ReportSummaryFields = z.infer<typeof reportSummarySchema>;

const REPORT_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    overallResult: { type: 'string' },
    engineCondition: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          engine: { type: 'string' },
          egtMargin: { type: ['string', 'null'] },
          llpCyclesRemaining: { type: ['integer', 'null'] },
        },
        required: ['engine', 'egtMargin', 'llpCyclesRemaining'],
        additionalProperties: false,
      },
    },
    adCompleted: { type: ['integer', 'null'] },
    adRemaining: { type: ['integer', 'null'] },
    costBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          amount: { type: ['number', 'null'] },
        },
        required: ['category', 'amount'],
        additionalProperties: false,
      },
    },
    totalCost: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    nextMilestoneDescription: { type: ['string', 'null'] },
    nextMilestoneEstimatedDate: { type: ['string', 'null'] },
  },
  required: [
    'overallResult', 'engineCondition', 'adCompleted', 'adRemaining',
    'costBreakdown', 'totalCost', 'currency',
    'nextMilestoneDescription', 'nextMilestoneEstimatedDate',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Tu condenses un rapport technique aéronautique (visite d'atelier, inspection, log de maintenance) en une fiche synthétique pour AeroOS.

Règles impératives :
- N'invente jamais de chiffre. Un champ non déterminable reste null.
- overallResult : 2-3 phrases résumant le résultat général du rapport.
- engineCondition : un élément par moteur mentionné. egtMargin en texte tel qu'exprimé dans le rapport (ex: "42°C", "12%") — ne convertis pas d'unité. llpCyclesRemaining : cycles restants sur la pièce limitante la plus critique si mentionné.
- adCompleted / adRemaining : nombre d'Airworthiness Directives traitées / restantes.
- costBreakdown : postes de coût identifiés dans le rapport (ex: "Main d'œuvre", "Pièces moteur"). totalCost : total si indiqué ou calculable par somme des postes.
- nextMilestoneDescription / nextMilestoneEstimatedDate (YYYY-MM-DD si déterminable) : prochaine échéance de maintenance mentionnée.
- Toute valeur chiffrée que tu produis est une estimation issue d'un résumé automatique, jamais une donnée certifiée.`;

export interface ReportSummaryResult {
  fields: ReportSummaryFields;
  modelName: string;
}

export async function summarizeTechnicalReport(
  documentText: string
): Promise<ReportSummaryResult> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: MODEL_NAME,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: documentText }],
    output_config: {
      format: { type: 'json_schema', schema: REPORT_SUMMARY_JSON_SCHEMA },
    },
  });

  const parsed = reportSummarySchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error('Résumé IA : sortie non structurée (échec du parsing)');
  }

  return { fields: parsed.data, modelName: MODEL_NAME };
}
