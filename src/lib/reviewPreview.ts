export interface ReviewPreview {
  preview: string;
  truncated: boolean;
}

export function previewReviewComment(comment: string, maxWords = 50): ReviewPreview {
  const original = String(comment || '');
  const matches = Array.from(original.matchAll(/\S+/gu));

  if (matches.length <= maxWords) {
    return { preview: original, truncated: false };
  }

  const lastMatch = matches[maxWords - 1];
  const preview = `${original.slice(0, (lastMatch.index ?? 0) + lastMatch[0].length).trimEnd()}...`;
  return { preview, truncated: true };
}
