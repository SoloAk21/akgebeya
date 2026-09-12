import type { ErrorRequestHandler, RequestHandler } from 'express';

const safeErrors = {
  PAYMENT_VERIFICATION_UNAVAILABLE:{status:502,message:'Payment verification is unavailable'},
  PAYMENT_VERIFICATION_MISMATCH:{status:502,message:'Payment verification could not confirm the expected transaction'},
  PAYMENT_INITIALIZATION_REJECTED: {status:502,message:'Payment initialization was rejected'},
  PAYMENT_INITIALIZATION_UNKNOWN: {status:502,message:'Payment initialization outcome is unresolved'},

  AI_UNAVAILABLE: { status: 503, message: 'Listing assistance is unavailable' },
  AI_TIMEOUT: { status: 504, message: 'Listing assistance timed out' },
  AI_RATE_LIMITED: { status: 429, message: 'Listing assistance is busy; try later' },
  AI_OUTPUT_INVALID: { status: 502, message: 'Listing assistance returned unusable content' },
  LISTING_INCOMPLETE: { status: 422, message: 'Listing information is incomplete or invalid' },
  LISTING_TRANSITION_CONFLICT: { status: 409, message: 'Listing cannot make this transition' },
  LISTING_NOT_FOUND: { status: 404, message: 'Listing not found' },
  LISTING_CONFLICT: { status: 409, message: 'Listing is not an editable draft' },
  PRECONDITION_REQUIRED: { status: 428, message: 'If-Match is required' },
  PRECONDITION_FAILED: { status: 412, message: 'Listing changed; retrieve it again' },
  PROVIDER_CONFLICT: { status: 409, message: 'Provider state conflicts with this request' },
  PROVIDER_NOT_FOUND: { status: 404, message: 'Provider profile not found' },
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

const listingValidationFields=['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','locationId','price','currency','bedrooms','bathrooms','areaSqm','publishedAt'] as const;
export type ListingValidationField=typeof listingValidationFields[number];
export class ListingIncompleteError extends HttpError {
  readonly fields:readonly ListingValidationField[];
  constructor(fields:readonly ListingValidationField[]){
    super('LISTING_INCOMPLETE');
    this.fields=[...new Set(fields.filter(field=>listingValidationFields.includes(field)))];
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
    response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error instanceof ListingIncompleteError ? { fields: error.fields } : {}) } });
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
