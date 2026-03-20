// Pick only allowed fields from a request body.
// Prevents clients from writing to fields they shouldn't have access to.

export function pickAllowed(body, allowedFields) {
  const filtered = {};
  for (const key of allowedFields) {
    if (key in body) filtered[key] = body[key];
  }
  return filtered;
}
