/**
 * Multi-word search with AND semantics.
 * All terms must match (case-insensitive) against content or tags.
 */
export function matchesQuery(content: string, tags: string[], query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return true;

  const lowerContent = content.toLowerCase();
  const lowerTags = tags.map(t => t.toLowerCase());

  return terms.every(term =>
    lowerContent.includes(term) || lowerTags.some(tag => tag.includes(term))
  );
}
