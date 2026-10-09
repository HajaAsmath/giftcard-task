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
