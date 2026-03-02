// PIN auth middleware — like a badge reader at a facility gate.
// Each role gets a PIN that grants access to its section of the API.
// Sends role downstream via req.role so routes can check permissions.

const PINS = {
  owner:   process.env.PIN_OWNER,
  florist: process.env.PIN_FLORIST,
  driver:  process.env.PIN_DRIVER,
};

// Route access per role
const ROLE_ACCESS = {
  owner:   ['orders', 'customers', 'stock', 'deliveries', 'dashboard', 'analytics', 'stock-purchases', 'auth'],
  florist: ['orders', 'customers', 'stock', 'stock-purchases'],
  driver:  ['deliveries'],
};

export function authenticate(req, res, next) {
  const pin = req.headers['x-auth-pin'];

  if (!pin) {
    return res.status(401).json({ error: 'PIN required. Send X-Auth-PIN header.' });
  }

  const role = Object.keys(PINS).find((r) => PINS[r] === pin);

  if (!role) {
    return res.status(401).json({ error: 'Invalid PIN.' });
  }

  req.role = role;
  next();
}

// Route guard — checks that the role has access to the resource.
// Usage: router.use(authorize('stock'))
export function authorize(resource) {
  return (req, res, next) => {
    if (!ROLE_ACCESS[req.role]?.includes(resource)) {
      return res.status(403).json({
        error: `Role "${req.role}" does not have access to /${resource}.`,
      });
    }
    next();
  };
}
