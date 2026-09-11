import type { ErrorRequestHandler, RequestHandler } from 'express';

const safeErrors = {
  ACCOUNT_LINKING_CONFLICT: { status: 409, message: 'Account linking required' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  FORBIDDEN: { status: 403, message: 'Access denied' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Please try again later' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service unavailable' },
  BAD_REQUEST: { status: 400, message: 'Invalid request' },
} as const;

export class HttpError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof safeErrors) {
    super(safeErrors[code].message);
    this.status = safeErrors[code].status;
  }
}

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    if (error.status === 401) response.set('WWW-Authenticate', 'Bearer');
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Only expose fixed messages for known body-parser failures.
  const type = typeof error === 'object' && error !== null && 'type' in error
    ? error.type : undefined;
  if (type === 'entity.parse.failed') {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } });
    return;
  }
  if (type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    return;
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    response.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported body encoding' } });
    return;
  }

  console.error('Unhandled request error');
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
