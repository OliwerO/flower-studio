// Anti-drift lock between the two Variety-identity implementations.
//
//   backend/src/utils/varietyIdentity.js        — the door (#603)
//   packages/shared/utils/varietyIdentity.js    — what the screen shows the user (#605)
//
// They must answer "is this the same flower?" identically. If the client
// under-matches, a screen tells the owner "this flower doesn't exist yet",
// she confirms creating it, and the confirmed path sends `newVariety: true` —
// which deliberately bypasses the server's duplicate guard. The duplicate then
// lands anyway, and the whole feature has been defeated by a normalisation
// mismatch.
//
// Both suites drive the SAME case list, so a rule added on one side and not the
// other fails here rather than shipping.

import { describe, it, expect } from 'vitest';
import {
  sameVariety as serverSameVariety,
  normaliseIdentityValue as serverNormalise,
  normaliseSize as serverNormaliseSize,
  isDatedBatchName as serverIsDatedBatchName,
} from '../utils/varietyIdentity.js';
import {
  sameVariety as clientSameVariety,
  normaliseIdentityValue as clientNormalise,
  normaliseSize as clientNormaliseSize,
  isDatedBatchName as clientIsDatedBatchName,
} from '../../../packages/shared/utils/varietyIdentity.js';
import {
  PARITY_CASES,
  BLANK_VALUES,
  SIZE_CASES,
  BATCH_NAME_CASES,
} from '../../../packages/shared/test/varietyIdentityParityCases.js';

describe('sameVariety — server and client agree', () => {
  it.each(PARITY_CASES)('$why', ({ a, b, same }) => {
    expect(serverSameVariety(a, b)).toBe(same);
    expect(clientSameVariety(a, b)).toBe(same);
    // and symmetrically, on both sides
    expect(serverSameVariety(b, a)).toBe(same);
    expect(clientSameVariety(b, a)).toBe(same);
  });
});

describe('normaliseIdentityValue — server and client agree', () => {
  it.each([...BLANK_VALUES, 'Peony', ' peony ', 'SARAH BERNHARDT'])('%o', (value) => {
    expect(serverNormalise(value)).toBe(clientNormalise(value));
  });
});

describe('normaliseSize — server and client agree', () => {
  it.each(SIZE_CASES)('%o → %o', (input, expected) => {
    expect(serverNormaliseSize(input)).toBe(expected);
    expect(clientNormaliseSize(input)).toBe(expected);
  });
});

describe('isDatedBatchName — server and client agree', () => {
  it.each(BATCH_NAME_CASES)('"%s" → %s', (name, expected) => {
    expect(serverIsDatedBatchName(name)).toBe(expected);
    expect(clientIsDatedBatchName(name)).toBe(expected);
  });
});
