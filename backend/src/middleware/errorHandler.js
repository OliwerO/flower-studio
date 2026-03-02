// Central error handler — the defect gate at the end of the line.
// All unhandled errors land here and get a consistent JSON response.
// Express identifies this as an error handler because it takes 4 arguments.

export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}`, err);

  // Airtable API errors carry a statusCode
  const status = err.statusCode || err.status || 500;

  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
