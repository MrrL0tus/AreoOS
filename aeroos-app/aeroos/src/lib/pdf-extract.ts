/**
 * Extraction de texte PDF à l'upload, pour alimenter extractedText
 * (indexé en full-text par le trigger Postgres — cf. rls.sql §5).
 * Best-effort : un PDF illisible (scanné, corrompu) ne doit jamais faire
 * échouer l'upload, juste laisser extractedText vide.
 */
import { PDFParse } from 'pdf-parse';

export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = result.text?.trim();
      return text ? text : null;
    } finally {
      await parser.destroy();
    }
  } catch {
    return null;
  }
}
