import { candidateCreateSchema, type CandidateCreateInput } from '@devrank/contracts';

export const CSV_IMPORT_MAX_BYTES = 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 500;
export const CSV_IMPORT_MAX_FIELDS = 500;
export const CSV_IMPORT_MAX_COLUMNS = 50;

export type CsvField = 'name' | 'email' | 'githubUsername' | 'leetcodeUsername';
export type CsvMapping = Record<CsvField, number | null>;
export type ParsedCsvRow = { rowNumber: number; values: string[]; parseError?: string };
export type ParsedCsv = { headers: string[]; rows: ParsedCsvRow[]; error?: string };
export type MappedCsvRow = { rowNumber: number; original: string[]; candidate?: CandidateCreateInput; errors: string[]; duplicateInFile: boolean };
export type CandidateImportAttempt = { fingerprint: string; idempotencyKey: string; storageKey: string };

function freshImportUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

export async function getCandidateImportAttempt(
  rows: Array<{ rowNumber: number; candidate: CandidateCreateInput }>,
  skipDuplicates: boolean,
  currentAttempt: CandidateImportAttempt | null,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): Promise<CandidateImportAttempt> {
  const serialized = JSON.stringify({ rows, skipDuplicates });
  if (currentAttempt?.fingerprint === serialized) return currentAttempt;

  const encoded = new TextEncoder().encode(serialized);
  let fingerprint = `${rows.length}-${skipDuplicates}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    fingerprint = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  const storageKey = `devrank:candidate-import:${fingerprint}`;
  if (!storage) throw new Error('Browser session storage is required to safely retry this import. Enable site storage and try again.');
  let idempotencyKey = '';
  try { idempotencyKey = storage.getItem(storageKey) ?? ''; }
  catch { throw new Error('Browser session storage is unavailable. Enable site storage to safely import candidates.'); }
  if (!idempotencyKey) {
    idempotencyKey = freshImportUuid();
    try { storage.setItem(storageKey, idempotencyKey); }
    catch { throw new Error('Browser session storage is unavailable. Enable site storage to safely import candidates.'); }
  }
  return { fingerprint: serialized, idempotencyKey, storageKey };
}

const aliases: Record<CsvField, Set<string>> = {
  name: new Set(['name', 'fullname', 'candidatename', 'candidate', 'applicantname']),
  email: new Set(['email', 'emailaddress', 'candidateemail', 'applicantemail']),
  githubUsername: new Set(['github', 'githubusername', 'githubhandle', 'githubprofile', 'githubprofileurl']),
  leetcodeUsername: new Set(['leetcode', 'leetcodeusername', 'leetcodehandle', 'leetcodeprofile', 'leetcodeprofileurl']),
};

function headerKey(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, ''); }

export function createCsvMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = { name: null, email: null, githubUsername: null, leetcodeUsername: null };
  for (const field of Object.keys(aliases) as CsvField[]) {
    const matches = headers.flatMap((header, index) => aliases[field].has(headerKey(header)) ? [index] : []);
    mapping[field] = matches.length === 1 ? matches[0] : null;
  }
  return mapping;
}

export function parseCsvText(source: string): ParsedCsv {
  const text = source.replace(/^\uFEFF/, '');
  if (!text.trim()) return { headers: [], rows: [], error: 'The selected CSV is empty.' };
  const records: Array<{ values: string[]; rowNumber: number; parseError?: string }> = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;
  let recordError: string | undefined;
  const pushField = () => { fields.push(field); field = ''; afterQuote = false; };
  const pushRecord = () => {
    pushField();
    if (fields.some((value) => value.length > 0) || records.length === 0) records.push({ values: fields, rowNumber: recordLine, ...(recordError ? { parseError: recordError } : {}) });
    fields = [];
    recordError = undefined;
    recordLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { inQuotes = false; afterQuote = true; }
      } else {
        field += char;
        if (char === '\n') line += 1;
        else if (char === '\r' && text[index + 1] !== '\n') line += 1;
      }
      continue;
    }
    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n') {
      recordError ??= `Unexpected character after a closing quote on row ${recordLine}.`;
      field += char;
      afterQuote = false;
      continue;
    }
    if (char === '"' && field.length === 0) { inQuotes = true; continue; }
    if (char === ',') { pushField(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (char === '"') recordError ??= `Unexpected quote on row ${recordLine}.`;
    field += char;
  }
  if (inQuotes) return { headers: [], rows: [], error: `The CSV contains an unclosed quoted field beginning on row ${recordLine}.` };
  if (field.length > 0 || fields.length > 0 || text.endsWith(',')) pushRecord();
  if (records.length < 2) return { headers: records[0]?.values ?? [], rows: [], error: 'The CSV must contain a header row and at least one candidate row.' };

  const headers = records[0].values.map((header) => header.trim());
  if (headers.length > CSV_IMPORT_MAX_COLUMNS) return { headers, rows: [], error: `The CSV has more than ${CSV_IMPORT_MAX_COLUMNS} columns.` };
  if (headers.some((header) => !header)) return { headers, rows: [], error: 'Every CSV column needs a header. Rename empty headers and upload the file again.' };
  const duplicates = new Set<string>();
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    const normalized = headerKey(header);
    if (seenHeaders.has(normalized)) duplicates.add(header);
    seenHeaders.add(normalized);
  }
  const rows = records.slice(1).map((record) => ({
    rowNumber: record.rowNumber,
    values: record.values,
    ...(record.parseError ? { parseError: record.parseError } : {}),
    ...(!record.parseError && record.values.length !== headers.length ? { parseError: `Expected ${headers.length} columns but found ${record.values.length}.` } : {}),
    ...(record.values.some((value) => value.length > CSV_IMPORT_MAX_FIELDS) ? { parseError: `A field exceeds the ${CSV_IMPORT_MAX_FIELDS} character limit.` } : {}),
  }));
  if (rows.length > CSV_IMPORT_MAX_ROWS) return { headers, rows: [], error: `The CSV exceeds the ${CSV_IMPORT_MAX_ROWS} candidate row limit.` };
  if (duplicates.size) {
    // Duplicate headers are retained for manual selection; preview labels distinguish each column by position.
  }
  return { headers, rows };
}

function normalizeProfile(value: string, platform: 'github' | 'leetcode'): { username?: string; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return {};
  let username = trimmed;
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      const segments = url.pathname.split('/').filter(Boolean);
      const validHost = platform === 'github'
        ? url.hostname.toLowerCase() === 'github.com' && segments.length === 1
        : url.hostname.toLowerCase() === 'leetcode.com' && segments.length === 2 && segments[0].toLowerCase() === 'u';
      if (url.protocol !== 'https:' || !validHost) return { error: `Use a username or a recognized ${platform === 'github' ? 'github.com/username' : 'leetcode.com/u/username'} profile URL.` };
      username = segments[segments.length - 1];
    } catch {
      return { error: `Enter a valid ${platform === 'github' ? 'GitHub' : 'LeetCode'} username or profile URL.` };
    }
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(username)) return { error: `The ${platform === 'github' ? 'GitHub' : 'LeetCode'} profile value is not a valid username.` };
  return { username };
}

export function mapCsvRows(rows: ParsedCsvRow[], mapping: CsvMapping, edits: Record<number, Partial<Record<CsvField, string>>> = {}): MappedCsvRow[] {
  const mapped = rows.map((row): MappedCsvRow => {
    const errors = row.parseError ? [row.parseError] : [];
    const sourceValue = (field: CsvField) => {
      const edited = edits[row.rowNumber]?.[field];
      return edited ?? (mapping[field] === null ? '' : row.values[mapping[field]!] ?? '');
    };
    const name = sourceValue('name').trim();
    const email = sourceValue('email').trim();
    const githubValue = sourceValue('githubUsername');
    const leetcodeValue = sourceValue('leetcodeUsername');
    const github = normalizeProfile(githubValue, 'github');
    const leetcode = normalizeProfile(leetcodeValue, 'leetcode');
    if (!name) errors.push('Candidate name is required.');
    if (github.error) errors.push(github.error);
    if (leetcode.error) errors.push(leetcode.error);
    const input = {
      name,
      ...(email ? { email } : {}),
      ...(github.username ? { githubUsername: github.username } : {}),
      ...(leetcode.username ? { leetcodeUsername: leetcode.username } : {}),
    };
    const validated = candidateCreateSchema.safeParse(input);
    if (!validated.success) {
      for (const issue of validated.error.issues) errors.push(issue.path[0] === 'email' ? 'Enter a valid email address.' : issue.path[0] === 'name' ? 'Candidate name must be 1–120 characters.' : issue.message);
    }
    return { rowNumber: row.rowNumber, original: row.values, ...(validated.success && !github.error && !leetcode.error && !row.parseError ? { candidate: validated.data } : {}), errors: [...new Set(errors)], duplicateInFile: false };
  });
  const seen = new Set<string>();
  return mapped.map((row) => {
    if (!row.candidate) return row;
    const keys = [row.candidate.email && `email:${row.candidate.email.toLowerCase()}`, row.candidate.githubUsername && `github:${row.candidate.githubUsername.toLowerCase()}`, row.candidate.leetcodeUsername && `leetcode:${row.candidate.leetcodeUsername.toLowerCase()}`].filter((key): key is string => Boolean(key));
    const duplicateInFile = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    return { ...row, duplicateInFile };
  });
}

export function csvHeaderLabel(header: string, index: number, headers: string[]) {
  const duplicatePosition = headers.slice(0, index).filter((value) => headerKey(value) === headerKey(header)).length;
  const duplicateCount = headers.filter((value) => headerKey(value) === headerKey(header)).length;
  return duplicateCount > 1 ? `${header} (#${duplicatePosition + 1})` : header;
}
