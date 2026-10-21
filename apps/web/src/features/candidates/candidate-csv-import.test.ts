import { describe, expect, it } from 'vitest';
import { csvHeaderLabel, createCsvMapping, getCandidateImportAttempt, mapCsvRows, openCsvFilePicker, parseCsvText, readCandidateCsvFile, takeSelectedCsvFile } from './candidate-csv-import';

function csvFile(name: string, value: string): File {
  const blob = new Blob([value]);
  return { name, size: blob.size, arrayBuffer: () => blob.arrayBuffer() } as File;
}

describe('CSV file picker handoff', () => {
  it('clears the native input and opens the picker synchronously', () => {
    const clickValues: string[] = [];
    const input = { value: 'C:\\fakepath\\people.csv', click: () => clickValues.push(input.value) };

    openCsvFilePicker(input);

    expect(clickValues).toEqual(['']);
    expect(input.value).toBe('');
    expect(openCsvFilePicker(null)).toBeUndefined();
  });

  it('hands the selected file to the import flow and resets the input for repeat selection', () => {
    const file = { name: 'people.csv' } as File;
    const input = { files: [file] as unknown as FileList, value: 'C:\\fakepath\\people.csv' };

    expect(takeSelectedCsvFile(input)).toBe(file);
    expect(input.value).toBe('');
    expect(takeSelectedCsvFile({ files: null, value: '' })).toBeNull();
  });

  it('reads and maps all rows from a selected CSV, including when the same file is selected again', async () => {
    const file = csvFile('devrank_dummy_candidates.csv', [
      'Candidate Name,Email,GitHub,LeetCode',
      'Ari Stone,ari@example.com,aristone,ari-lc',
      'Bea Cruz,bea@example.com,beacruz,bea-lc',
      'Cal Dean,cal@example.com,caldean,cal-lc',
      'Dee Ellis,dee@example.com,deellis,dee-lc',
      'Eli Fox,eli@example.com,elifox,eli-lc',
    ].join('\n'));

    const firstRead = await readCandidateCsvFile(file);
    const secondRead = await readCandidateCsvFile(file);
    const mappedRows = mapCsvRows(firstRead.rows, createCsvMapping(firstRead.headers));

    expect(firstRead.headers).toEqual(['Candidate Name', 'Email', 'GitHub', 'LeetCode']);
    expect(mappedRows).toHaveLength(5);
    expect(mappedRows[0].candidate).toEqual({ name: 'Ari Stone', email: 'ari@example.com', githubUsername: 'aristone', leetcodeUsername: 'ari-lc' });
    expect(secondRead.rows).toHaveLength(5);
  });

  it('returns a useful parser error for malformed CSV and a read error for invalid UTF-8', async () => {
    await expect(readCandidateCsvFile(csvFile('bad.csv', 'Name,Email\n"Ari,ari@example.com'))).resolves.toMatchObject({ error: expect.stringMatching(/unclosed quoted/i) });
    const invalidUtf8 = { name: 'bad.csv', size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer } as File;
    await expect(readCandidateCsvFile(invalidUtf8)).rejects.toThrow(/valid UTF-8 CSV/i);
  });
});

describe('candidate CSV import parsing and mapping', () => {
  it('parses quoted commas, escaped quotes, Unicode, and LF/CRLF records', () => {
    const parsed = parseCsvText('Full Name,Email,GitHub,LeetCode\r\n"Kamthe, Atharva",athar@example.com,https://github.com/atharva,https://leetcode.com/u/atharva/\r\n"Miyuki ""Miu"" 雪",miu@example.com,miu,miu-lc');
    expect(parsed.error).toBeUndefined();
    expect(parsed.headers).toEqual(['Full Name', 'Email', 'GitHub', 'LeetCode']);
    expect(parsed.rows.map((row) => row.values)).toEqual([
      ['Kamthe, Atharva', 'athar@example.com', 'https://github.com/atharva', 'https://leetcode.com/u/atharva/'],
      ['Miyuki "Miu" 雪', 'miu@example.com', 'miu', 'miu-lc'],
    ]);
    expect(parsed.rows[0].rowNumber).toBe(2);
  });

  it('supports multiple header aliases and normalizes recognized profile URLs', () => {
    const parsed = parseCsvText('Candidate Name,Email Address,GitHub Profile URL,LeetCode Username\nTaylor,taylor@example.com,https://github.com/taylor-dev,tcoder');
    const mapping = createCsvMapping(parsed.headers);
    const rows = mapCsvRows(parsed.rows, mapping);
    expect(rows[0]).toMatchObject({
      candidate: { name: 'Taylor', email: 'taylor@example.com', githubUsername: 'taylor-dev', leetcodeUsername: 'tcoder' },
      errors: [],
    });
  });

  it('flags ambiguous duplicate headers and gives every duplicate a distinct mapping label', () => {
    const parsed = parseCsvText('Name,Full Name,Email,GitHub,LeetCode\nFirst,Second,a@example.com,one,lc');
    expect(createCsvMapping(parsed.headers).name).toBeNull();
    expect(csvHeaderLabel('Name', 0, ['Name', 'name', 'Email'])).toBe('Name (#1)');
    expect(csvHeaderLabel('name', 1, ['Name', 'name', 'Email'])).toBe('name (#2)');
  });

  it('reports row-width errors, unclosed quotes, empty files, and field limits', () => {
    expect(parseCsvText('').error).toMatch(/empty/i);
    const width = parseCsvText('Name,Email\nA,a@example.com,extra');
    expect(width.rows[0].parseError).toMatch(/expected 2 columns/i);
    expect(parseCsvText('Name,Email\n"Taylor,taylor@example.com').error).toMatch(/unclosed quoted/i);
    const long = parseCsvText(`Name\n${'A'.repeat(501)}`);
    expect(long.rows[0].parseError).toMatch(/500 character limit/i);
  });

  it('does not guess unsupported profile URLs and marks in-file identity matches', () => {
    const parsed = parseCsvText('Name,Email,GitHub,LeetCode\nA,same@example.com,https://github.com/a/repo,b');
    const rows = mapCsvRows(parsed.rows, createCsvMapping(parsed.headers));
    expect(rows[0].candidate?.githubUsername).toBeUndefined();
    expect(rows[0].errors[0]).toMatch(/recognized github\.com/i);
    const duplicates = parseCsvText('Name,Email,GitHub,LeetCode\nA,same@example.com,a,b\nDifferent name,SAME@example.com,c,d');
    expect(mapCsvRows(duplicates.rows, createCsvMapping(duplicates.headers))[1].duplicateInFile).toBe(true);
  });

  it('requires a valid name and validates email without converting missing fields to values', () => {
    const parsed = parseCsvText('Name,Email\n,not-an-email\nTaylor,');
    const rows = mapCsvRows(parsed.rows, createCsvMapping(parsed.headers));
    expect(rows[0].candidate).toBeUndefined();
    expect(rows[0].errors).toContain('Candidate name is required.');
    expect(rows[0].errors).toContain('Enter a valid email address.');
    expect(rows[1].candidate).toEqual({ name: 'Taylor' });
  });

  it('persists retry keys and refuses imports when session storage is unavailable', async () => {
    const rows = [{ rowNumber: 2, candidate: { name: 'Taylor', email: 'taylor@example.com' } }];
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
    const first = await getCandidateImportAttempt(rows, true, null, storage);
    await expect(getCandidateImportAttempt(rows, true, null, storage)).resolves.toMatchObject({ idempotencyKey: first.idempotencyKey });
    const retry = await getCandidateImportAttempt(rows, true, first, null);
    const changedBatch = await getCandidateImportAttempt([{ rowNumber: 2, candidate: { name: 'Morgan' } }], true, retry, storage);

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(changedBatch.idempotencyKey).not.toBe(first.idempotencyKey);
    await expect(getCandidateImportAttempt(rows, true, null, null)).rejects.toThrow(/session storage is required/i);
  });
});
