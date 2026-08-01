import { screen, fireEvent } from '@testing-library/react';

/**
 * Set a Variety attribute the way a person does (#610).
 *
 * Since `NewVarietyFields` moved from text boxes to `ValueCombobox`, typing
 * alone no longer commits — that is the whole point, because a typed near-miss
 * used to mint a rival attribute value and split a flower's stock across two
 * cards. So a test that wants a value has to choose it, exactly like the owner:
 * click the create row when the value is new, otherwise let the field close and
 * snap onto the stored option.
 *
 * Not named `*.test.js` on purpose — vitest's default include would try to run
 * it as a suite.
 */
export function setVarietyValue(testId, value) {
  const el = screen.getByTestId(testId);
  fireEvent.change(el, { target: { value } });
  const create = screen.queryByTestId(`${testId}-create`);
  if (create) fireEvent.click(create);
  else fireEvent.blur(el);
  return el;
}
