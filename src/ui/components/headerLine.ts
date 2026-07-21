/** A pasted `name: value` line, split at its first colon. */
export function parseHeaderLine(
  text: string,
): { name: string; value: string } | undefined {
  const colon = text.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const name = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  return name === "" || value === "" || /\s/.test(name)
    ? undefined
    : { name, value };
}
