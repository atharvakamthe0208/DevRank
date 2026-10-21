const excludedNameWords = new Set([
  'resume', 'curriculum', 'vitae', 'profile', 'summary', 'objective', 'experience', 'skills', 'education', 'projects', 'contact', 'portfolio',
  'software', 'engineer', 'engineering', 'developer', 'development', 'senior', 'junior', 'lead', 'principal', 'staff', 'full', 'stack',
  'frontend', 'backend', 'mobile', 'manager', 'scientist', 'analyst', 'designer', 'consultant', 'intern', 'specialist', 'professional',
  'email', 'phone', 'address', 'linkedin', 'github', 'architect', 'data', 'cloud', 'platform', 'security',
  'technical', 'product', 'director', 'executive', 'quality', 'tester', 'writer', 'teacher', 'coordinator',
  'operations', 'research', 'open', 'source', 'technology', 'technologies', 'solutions', 'company', 'university', 'college', 'team',
]);
const lowercaseNameParticles = new Set(['al', 'da', 'de', 'del', 'der', 'di', 'la', 'le', 'van', 'von']);

function normalizeCandidateName(raw: string): string | null {
  const candidate = raw
    .replace(/^(?:full\s+name|candidate\s+name|name)\s*[:\-]\s*/i, '')
    .split(/\s+(?:\||•|·|—|–|-)\s+/)[0]
    .replace(/^[\s|•·—–]+|[\s|•·—–,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (candidate.length < 3 || candidate.length > 120 || /[@\d]|https?:\/\/|www\./i.test(candidate)) return null;
  const parts = candidate.split(' ');
  if (parts.length < 2 || parts.length > 5) return null;
  if (parts.some((part) => excludedNameWords.has(part.toLocaleLowerCase().replace(/[.,]/g, '')))) return null;
  const validPart = (part: string) => lowercaseNameParticles.has(part.toLocaleLowerCase())
    || /^(?:\p{Lu}\.?|\p{Lu}[\p{L}\p{M}'’.-]*)$/u.test(part);
  if (!parts.every(validPart) || !/\p{Lu}/u.test(parts.at(-1) ?? '')) return null;
  return candidate;
}

function comparable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Resume names are normally printed as a short heading near the top. This accepts
 * explicit name labels anywhere or a plausible name heading among the first eight
 * non-empty lines. It never derives names from filenames, emails, or body prose.
 */
export function extractCandidateName(text: string, proposedName?: string | null): string | null {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const explicit = lines
    .map((line) => line.match(/^(?:full\s+name|candidate\s+name|name)\s*[:\-]\s*(.{2,120})$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeCandidateName(value))
    .find((value): value is string => Boolean(value));
  const topCandidates = lines.slice(0, 8)
    .map((line) => normalizeCandidateName(line))
    .filter((value): value is string => Boolean(value));
  const candidates = explicit ? [explicit, ...topCandidates] : topCandidates;
  if (!candidates.length) return null;

  // A provider proposal can help choose among visible name headings, but is never
  // accepted unless it exactly matches one of those extracted source lines.
  const validatedProposal = proposedName ? candidates.find((candidate) => comparable(candidate) === comparable(proposedName)) : undefined;
  return validatedProposal ?? explicit ?? topCandidates[0] ?? null;
}
