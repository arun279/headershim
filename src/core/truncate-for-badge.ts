const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function truncateForBadge(text: string, maxLength: number): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
    throw new RangeError("maxLength must be a non-negative safe integer");
  }

  if (maxLength === 0) {
    return "";
  }

  const graphemes = Array.from(
    graphemeSegmenter.segment(text),
    ({ segment }) => segment,
  );
  if (graphemes.length <= maxLength) {
    return text;
  }

  return `${graphemes.slice(0, maxLength - 1).join("")}…`;
}
