// Subsets the two source TTFs down to WOFF2 (printable ASCII + a handful of
// typographic punctuation the UI copy uses).
import fs from 'node:fs';
import subsetFont from 'subset-font';

const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const EXTRA_PUNCTUATION = '“”‘’…×·−–'; // " " ' ' … × · − –
export const SUBSET_TEXT = PRINTABLE_ASCII + EXTRA_PUNCTUATION;

export async function subsetToWoff2(srcTtfPath, outWoff2Path) {
  const buffer = fs.readFileSync(srcTtfPath);
  const subset = await subsetFont(buffer, SUBSET_TEXT, { targetFormat: 'woff2' });
  fs.writeFileSync(outWoff2Path, subset);
  return subset.length;
}
