// Feet-and-inches parsing. A spec sheet reads `27'-4"`, not `27.333` — every
// dimension field in the sidebar accepts either, so a number can be copied off
// the sheet without doing the arithmetic first.

/**
 * Parse a dimension typed as plain decimal feet OR feet-inches, in any of the
 * common spellings: `27`, `27.5`, `27'`, `27'-4"`, `27' 4"`, `27'4`, `4"`,
 * `4in`, `27ft 4in`. Returns NaN if the text isn't a recognisable number so
 * the caller can leave the field alone mid-edit rather than zero it out.
 * @param {string|number} input
 * @returns {number} feet, decimal
 */
export function parseFeet(input) {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  const s = String(input).trim();
  if (!s) return NaN;

  // Plain decimal, no unit marks.
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);

  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^-/, '');

  // feet' inches" — the quote marks may be straight ('  ") or curly (’ ”),
  // the inch mark is optional, and the separator between the two numbers may
  // be a space, a hyphen, or nothing at all.
  let m = body.match(/^(\d+(?:\.\d+)?)\s*[' ’]\s*-?\s*(\d+(?:\.\d+)?)?\s*["”]?\s*$/);
  if (m) {
    const ft = parseFloat(m[1]);
    const inch = m[2] ? parseFloat(m[2]) : 0;
    return sign * (ft + inch / 12);
  }

  // inches only.
  m = body.match(/^(\d+(?:\.\d+)?)\s*(?:["”]|in\.?)$/i);
  if (m) return sign * (parseFloat(m[1]) / 12);

  // "27 ft 4 in" spelled out.
  m = body.match(/^(\d+(?:\.\d+)?)\s*ft\.?\s*(?:(\d+(?:\.\d+)?)\s*in\.?)?$/i);
  if (m) {
    const ft = parseFloat(m[1]);
    const inch = m[2] ? parseFloat(m[2]) : 0;
    return sign * (ft + inch / 12);
  }

  const f = parseFloat(s);
  return Number.isFinite(f) ? f : NaN;
}
