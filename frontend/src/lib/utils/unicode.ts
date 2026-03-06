/**
 * Normalize filename to NFC (Normalized Form Composed) to ensure consistent
 * Unicode representation across different systems, especially macOS which
 * can use NFD (Normalized Form Decomposed).
 *
 * @param filename The filename to normalize
 * @returns The filename normalized to NFC form
 */
export const normalizeFilenameToNFC = (filename: string): string => {
  try {
    // Normalize to NFC (Normalized Form Composed)
    return filename.normalize('NFC');
  } catch {
    return filename;
  }
};
