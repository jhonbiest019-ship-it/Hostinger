export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) { const char = text[i]; const next = text[i + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { row.push(cell); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") i += 1; row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ""; } else cell += char; }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  if (rows.length < 2) return [];
  const seen: Record<string, number> = {};
  const headers = rows[0].map((header, index) => {
    const raw = header.trim().toLowerCase() || `column_${index + 1}`;
    if (seen[raw] !== undefined) {
      seen[raw] += 1;
      return `${raw}_${seen[raw]}`;
    }
    seen[raw] = 1;
    return raw;
  });
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])));
}

export function csvValue(row: CsvRow, names: string[]) { const found = names.find((name) => row[name] !== undefined); return found ? row[found] : ""; }
