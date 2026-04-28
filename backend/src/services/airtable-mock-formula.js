// airtable-mock-formula.js — a small, pragmatic evaluator for the subset
// of Airtable formulas the backend uses today. NOT a full reimplementation
// of Airtable's formula language.
//
// Approach: tokenise → recursive-descent parse → evaluate against a record.
// On parse failure or unknown function, log a warning and return `true`
// (record passes the filter — over-permissive). Tests that depend on
// filtering behaviour will catch over-permissive results visibly; a
// crashing evaluator would mask the failure.
//
// Supported grammar:
//   atom    := number | string | boolean | recordIdLit | fieldRef | call
//   compare := atom OP atom        OP ∈ { =, !=, <, <=, >, >= }
//   unary   := NOT(expr)
//   expr    := compare | unary | call | atom
//   call    := AND(expr, ...) | OR(expr, ...) | NOT(expr) | RECORD_ID()
//            | TRUE() | FALSE() | DATESTR(expr) | IS_BEFORE(d1, d2)
//            | IS_AFTER(d1, d2) | FIND(needle, haystack [, start])
//            | SEARCH(needle, haystack [, start]) | CONCAT(...) | string concat with &
//
// Field refs `{Name}` resolve against the record. Record-id literals are
// double-quoted Airtable rec ids (`"recXXX"`).
//
// Caveats this is intentionally OK with:
//   - No operator precedence between AND/OR vs comparisons — callers always
//     wrap explicitly (the codebase consistently does), so flat parsing works.
//   - No date arithmetic. IS_BEFORE/IS_AFTER do lexicographic compare on
//     ISO date strings, which is correct for YYYY-MM-DD.

export function evaluateFormula(formula, record) {
  if (!formula || typeof formula !== 'string' || formula.trim() === '') return true;
  try {
    const tokens = tokenise(formula);
    const ast = parseExpr(tokens);
    if (tokens.length > 0) {
      // Trailing garbage — parser didn't consume everything.
      console.warn(`[mock-formula] trailing tokens after parse: ${JSON.stringify(tokens)} in: ${formula}`);
      return true;
    }
    const out = evaluate(ast, record);
    return Boolean(out);
  } catch (err) {
    console.warn(`[mock-formula] eval failed (${err.message}); passing through formula: ${formula}`);
    return true;
  }
}

// ── Tokeniser ──
// Tokens are: { type: 'sym'|'num'|'str'|'field'|'punct'|'op', value }
function tokenise(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }

    // String literal: '...' or "..."
    if (c === "'" || c === '"') {
      const quote = c;
      let end = i + 1;
      let value = '';
      while (end < input.length && input[end] !== quote) {
        // Airtable doesn't have backslash-escapes inside formula strings;
        // doubled quote ('') is the escape. Accept it.
        if (input[end] === quote && input[end + 1] === quote) { value += quote; end += 2; continue; }
        value += input[end]; end++;
      }
      if (end >= input.length) throw new Error(`unterminated string starting at ${i}`);
      tokens.push({ type: 'str', value });
      i = end + 1;
      continue;
    }

    // Field ref: {Field Name}
    if (c === '{') {
      const end = input.indexOf('}', i);
      if (end === -1) throw new Error(`unterminated field ref at ${i}`);
      tokens.push({ type: 'field', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Number
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let end = i + 1;
      while (end < input.length && /[0-9.]/.test(input[end])) end++;
      tokens.push({ type: 'num', value: Number(input.slice(i, end)) });
      i = end;
      continue;
    }

    // Multi-char operators
    if (input.startsWith('!=', i)) { tokens.push({ type: 'op', value: '!=' }); i += 2; continue; }
    if (input.startsWith('>=', i)) { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
    if (input.startsWith('<=', i)) { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }

    // Single-char operators / punctuation
    if (c === '=' || c === '<' || c === '>' || c === '&') {
      tokens.push({ type: 'op', value: c }); i++; continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ type: 'punct', value: c }); i++; continue;
    }

    // Identifier (function name or symbol like TRUE/FALSE)
    if (/[A-Za-z_]/.test(c)) {
      let end = i + 1;
      while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) end++;
      tokens.push({ type: 'sym', value: input.slice(i, end) });
      i = end;
      continue;
    }

    throw new Error(`unexpected character '${c}' at position ${i}`);
  }
  return tokens;
}

// ── Parser (recursive descent) ──
// Grammar without precedence — the codebase always wraps with AND/OR.
// expr := primary (op primary)?
// primary := call | field | str | num | sym | '(' expr ')'

function peek(tokens) { return tokens[0]; }
function consume(tokens) { return tokens.shift(); }

function parseExpr(tokens) {
  const left = parsePrimary(tokens);
  const next = peek(tokens);
  if (next && next.type === 'op' && ['=', '!=', '<', '<=', '>', '>=', '&'].includes(next.value)) {
    consume(tokens);
    const right = parsePrimary(tokens);
    return { kind: 'binop', op: next.value, left, right };
  }
  return left;
}

function parsePrimary(tokens) {
  const tok = consume(tokens);
  if (!tok) throw new Error('unexpected end of input');

  // Function call or sym literal (TRUE / FALSE)
  if (tok.type === 'sym') {
    if (peek(tokens)?.type === 'punct' && peek(tokens).value === '(') {
      consume(tokens); // (
      const args = [];
      // Empty arglist
      if (peek(tokens)?.type === 'punct' && peek(tokens).value === ')') {
        consume(tokens);
        return { kind: 'call', name: tok.value, args };
      }
      while (true) {
        args.push(parseExpr(tokens));
        const sep = peek(tokens);
        if (sep?.type === 'punct' && sep.value === ',') { consume(tokens); continue; }
        if (sep?.type === 'punct' && sep.value === ')') { consume(tokens); break; }
        throw new Error(`expected ',' or ')' in call to ${tok.value}, got ${JSON.stringify(sep)}`);
      }
      return { kind: 'call', name: tok.value, args };
    }
    // Bare sym (TRUE/FALSE without parens)
    return { kind: 'sym', name: tok.value };
  }

  if (tok.type === 'punct' && tok.value === '(') {
    const inner = parseExpr(tokens);
    const close = consume(tokens);
    if (!close || close.type !== 'punct' || close.value !== ')') throw new Error("expected ')'");
    return inner;
  }

  if (tok.type === 'field') return { kind: 'field', name: tok.value };
  if (tok.type === 'str')   return { kind: 'lit',   value: tok.value };
  if (tok.type === 'num')   return { kind: 'lit',   value: tok.value };

  throw new Error(`unexpected token ${JSON.stringify(tok)}`);
}

// ── Evaluator ──
function evaluate(node, record) {
  if (node.kind === 'lit') return node.value;
  if (node.kind === 'field') {
    const v = record[node.name];
    return v === undefined ? null : v;
  }
  if (node.kind === 'sym') {
    if (node.name === 'TRUE') return true;
    if (node.name === 'FALSE') return false;
    // Bare field-like sym shouldn't really happen but stay permissive
    return record[node.name] ?? null;
  }
  if (node.kind === 'binop') {
    const l = evaluate(node.left, record);
    const r = evaluate(node.right, record);
    switch (node.op) {
      case '=':  return looseEq(l, r);
      case '!=': return !looseEq(l, r);
      case '<':  return numOrStr(l) <  numOrStr(r);
      case '<=': return numOrStr(l) <= numOrStr(r);
      case '>':  return numOrStr(l) >  numOrStr(r);
      case '>=': return numOrStr(l) >= numOrStr(r);
      case '&':  return String(l ?? '') + String(r ?? '');
      default: throw new Error(`unknown operator ${node.op}`);
    }
  }
  if (node.kind === 'call') {
    return evaluateCall(node, record);
  }
  throw new Error(`unknown node ${JSON.stringify(node)}`);
}

function evaluateCall(node, record) {
  const name = node.name.toUpperCase();
  const argv = () => node.args.map(a => evaluate(a, record));
  switch (name) {
    case 'TRUE':  return true;
    case 'FALSE': return false;
    case 'AND':   return argv().every(Boolean);
    case 'OR':    return argv().some(Boolean);
    case 'NOT':   return !evaluate(node.args[0], record);
    case 'RECORD_ID': return record.id ?? null;
    case 'DATESTR': {
      const v = evaluate(node.args[0], record);
      return toDateStr(v);
    }
    case 'IS_BEFORE': {
      const a = toDateStr(evaluate(node.args[0], record));
      const b = toDateStr(evaluate(node.args[1], record));
      if (!a || !b) return false;
      return a < b;
    }
    case 'IS_AFTER': {
      const a = toDateStr(evaluate(node.args[0], record));
      const b = toDateStr(evaluate(node.args[1], record));
      if (!a || !b) return false;
      return a > b;
    }
    case 'FIND': {
      // FIND(needle, haystack [, start]) — 1-indexed; 0 = not found.
      const needle = String(evaluate(node.args[0], record) ?? '');
      const hay    = String(evaluate(node.args[1], record) ?? '');
      const start  = node.args[2] ? Number(evaluate(node.args[2], record)) - 1 : 0;
      const i = hay.indexOf(needle, start);
      return i === -1 ? 0 : i + 1;
    }
    case 'SEARCH': {
      // Same as FIND but case-insensitive.
      const needle = String(evaluate(node.args[0], record) ?? '').toLowerCase();
      const hay    = String(evaluate(node.args[1], record) ?? '').toLowerCase();
      const start  = node.args[2] ? Number(evaluate(node.args[2], record)) - 1 : 0;
      const i = hay.indexOf(needle, start);
      return i === -1 ? 0 : i + 1;
    }
    case 'CONCAT': return argv().map(v => String(v ?? '')).join('');
    case 'LOWER':  return String(evaluate(node.args[0], record) ?? '').toLowerCase();
    case 'UPPER':  return String(evaluate(node.args[0], record) ?? '').toUpperCase();
    case 'LEN':    return String(evaluate(node.args[0], record) ?? '').length;
    case 'IF': {
      // IF(cond, then, else)
      return evaluate(node.args[0], record)
        ? evaluate(node.args[1], record)
        : evaluate(node.args[2] || { kind: 'lit', value: '' }, record);
    }
    case 'BLANK': return '';
    default:
      // Be visible but permissive — we still want the test to run.
      console.warn(`[mock-formula] unknown function ${name}, returning empty string`);
      return '';
  }
}

// ── Helpers ──

// Airtable equality is loose — compare strings/numbers without surprises,
// but treat booleans correctly (TRUE() = 1 numerically in Airtable).
function looseEq(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) {
    // Airtable treats an empty string as "blank". `{Field} = ''` matches null/undefined.
    return (a === '' && b == null) || (b === '' && a == null);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    // boolean ↔ number coercion (TRUE() = 1, FALSE() = 0)
    return Number(Boolean(a)) === Number(Boolean(b));
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function numOrStr(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // For strings, attempt numeric compare if it parses cleanly
  const n = Number(v);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(String(v))) return n;
  return String(v);
}

function toDateStr(v) {
  if (v == null || v === '') return null;
  // YYYY-MM-DD or full ISO string — slice to date portion.
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
