export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error(`Unexpected quote at character ${index + 1}.`);
      quoted = true;
      continue;
    }

    if (character === ',') {
      row.push(field.trim());
      field = '';
      closedQuote = false;
      continue;
    }

    if (character === '\r' || character === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      closedQuote = false;
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      continue;
    }

    if (closedQuote) {
      if (!/\s/.test(character)) throw new Error(`Unexpected character after a quoted field at character ${index + 1}.`);
      continue;
    }
    field += character;
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}
