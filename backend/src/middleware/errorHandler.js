// Central error handler — the defect gate at the end of the line.
// All unhandled errors land here and get a consistent JSON response.
// Express identifies this as an error handler because it takes 4 arguments.

export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}`, err);

  // Airtable API errors carry a statusCode
  const status = err.statusCode || err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, hide internal error details (Airtable errors may leak
  // table names, field names, or API key fragments). In dev, show everything.
  const message = isProduction
    ? (status === 404 ? 'Not found' : 'Internal server error')
    : (err.message || 'Internal server error');

  res.status(status).json({
    error: message,
    ...(!isProduction && { details: err.message, stack: err.stack }),
  });
}
