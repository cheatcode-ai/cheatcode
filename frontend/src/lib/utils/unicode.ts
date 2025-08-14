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
  } catch (error) {
    console.warn('Failed to normalize filename to NFC:', filename, error);
    return filename;
  }
};

/**
 * Normalize file path to NFC (Normalized Form Composed) to ensure consistent
 * Unicode representation across different systems.
 * 
 * @param path The file path to normalize
 * @returns The path with all components normalized to NFC form
 */
export const normalizePathToNFC = (path: string): string => {
  try {
    // Normalize to NFC (Normalized Form Composed)
    return path.normalize('NFC');
  } catch (error) {
    console.warn('Failed to normalize path to NFC:', path, error);
    return path;
  }
}; 