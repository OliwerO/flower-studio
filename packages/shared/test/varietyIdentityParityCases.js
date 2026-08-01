// The Variety-identity parity contract — imported by BOTH implementations' tests.
//
// Not a test file itself (no describe/it), deliberately: the backend suite
// imports it, and importing a real test file would re-register the shared
// suite inside the backend run.
//
// Consumers:
//   packages/shared/test/varietyIdentity.test.js        (client)
//   backend/src/__tests__/varietyIdentity.parity.test.js (server)
//
// Every case is a pair of Variety 4-tuples, response-shaped
// (`{Type, Colour, Size, Cultivar}`), and whether they are the SAME flower.
// Both `sameVariety` implementations must agree on all of them, in both
// argument orders. Add a case here when you find a new way two spellings of
// one flower can drift apart — it is then automatically enforced on both sides.
//
// Why this matters more than a normal test: the client decides whether to show
// "you already have this" or "create a new one", and the confirmed-create path
// (`newVariety: true`) bypasses the server's own duplicate guard (#603). If the
// client under-matches relative to the server, the user is prompted to create a
// flower that already exists, clicks through, and the duplicate lands anyway.

export const PARITY_CASES = [
  { why: 'identical',                a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   same: true },
  { why: 'case drift on Type',       a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'peony', Colour: 'Pink', Size: 60, Cultivar: null },   same: true },
  { why: 'case drift on Colour',     a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Peony', Colour: 'PINK', Size: 60, Cultivar: null },   same: true },
  { why: 'whitespace drift',         a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: ' Peony ', Colour: 'Pink ', Size: 60, Cultivar: null }, same: true },
  { why: 'numeric-string size',      a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Peony', Colour: 'Pink', Size: '60', Cultivar: null }, same: true },
  { why: 'empty string is null',     a: { Type: 'Peony', Colour: null, Size: null, Cultivar: null },   b: { Type: 'Peony', Colour: '', Size: '', Cultivar: '' },         same: true },
  { why: 'cultivar case drift',      a: { Type: 'Rose', Colour: 'Red', Size: 50, Cultivar: 'Freedom' }, b: { Type: 'Rose', Colour: 'Red', Size: 50, Cultivar: 'freedom' }, same: true },
  { why: 'the sarah bernhardt case', a: { Type: 'Peony', Colour: 'Pink', Size: null, Cultivar: 'Sarah Bernhardt' }, b: { Type: 'peony', Colour: 'pink', Size: null, Cultivar: ' SARAH BERNHARDT ' }, same: true },
  { why: 'different size',           a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Peony', Colour: 'Pink', Size: 70, Cultivar: null },   same: false },
  { why: 'blank colour is not any',  a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Peony', Colour: null, Size: 60, Cultivar: null },    same: false },
  { why: 'different type',           a: { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },   b: { Type: 'Rose', Colour: 'Pink', Size: 60, Cultivar: null },    same: false },
  { why: 'cultivar present vs not',  a: { Type: 'Rose', Colour: 'Red', Size: 50, Cultivar: 'Freedom' }, b: { Type: 'Rose', Colour: 'Red', Size: 50, Cultivar: null },     same: false },
  { why: 'size 0 is a real size',    a: { Type: 'Moss', Colour: null, Size: 0, Cultivar: null },       b: { Type: 'Moss', Colour: null, Size: null, Cultivar: null },    same: false },
  { why: 'the pink peonies case',    a: { Type: 'Pink Peonies', Colour: 'Pink', Size: null, Cultivar: null }, b: { Type: 'Peony', Colour: 'Pink', Size: null, Cultivar: null }, same: false },
];

// Blank-normalisation cases — every one of these must read as "absent".
export const BLANK_VALUES = [null, undefined, '', '   '];

// Size-normalisation cases: [input, expected]. `0` is a real size; `''` is not.
export const SIZE_CASES = [
  [60, 60], ['60', 60], [' 60 ', 60], [0, 0], ['0', 0],
  ['', null], [null, null], [undefined, null], ['tall', null],
];

// Dated-Batch recognition: [name, isDatedBatch].
export const BATCH_NAME_CASES = [
  ['Peony Pink 60cm (24.Jul.)', true],
  ['Dahlia Coral (4.Jul)', true],
  ['Peony Pink 60cm', false],
  ['Peony (large)', false],
  ['', false],
];
