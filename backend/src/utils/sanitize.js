// Sanitizes user input before interpolation into Airtable filterByFormula strings.
// Airtable formulas use single-quoted strings like {Field} = 'value'.
// Without sanitization, a malicious value like "test', BLANK()) //" could
// break out of the string and inject arbitrary formula logic.
// Think of this as an input inspection gate — strip anything that could
// corrupt downstream processing.

/**
 * Remove or escape characters that could break Airtable formula syntax.
 * Strips: single quotes, backslashes, parentheses, commas.
 * @param {string} value - Raw user input
 * @returns {string} Sanitized string safe for formula interpolation
 */
export function sanitizeFormulaValue(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/['\\(),]/g, '');
}
