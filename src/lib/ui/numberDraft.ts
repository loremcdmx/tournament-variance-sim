export function normalizeNumericDraft(raw: string): string {
  if (raw === "") return raw;
  const match = raw.match(/^([+-]?)(\d+)(\.(\d*))?$/);
  if (!match) return raw;
  const [, sign, integerPart, fractionalPart = ""] = match;
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  return `${sign}${normalizedInteger}${fractionalPart}`;
}
