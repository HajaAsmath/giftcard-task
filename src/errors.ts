/** A refusal with an HTTP status and an explicit error code. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class BadRequest extends HttpError {
  constructor(code: string, message: string) { super(400, code, message); }
}

export class NotFound extends HttpError {
  constructor(code: string, message: string) { super(404, code, message); }
}

export class Conflict extends HttpError {
  constructor(code: string, message: string) { super(409, code, message); }
}

export function errorBody(err: HttpError) {
  return { error: { code: err.code, message: err.message } };
}

/** What a refused redemption attempted, kept so finance can see it. */
export interface RefusedMovement {
  card_id: string;
  store_id: string;
  amount_minor: number;
  occurred_at: string;
}

/** A refusal that is also stored as a Refused Movement. */
export class Refused extends HttpError {
  constructor(status: number, code: string, message: string, readonly movement: RefusedMovement) {
    super(status, code, message);
  }
}
