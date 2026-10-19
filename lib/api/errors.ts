export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const unauthorized = () => new HttpError(401, 'Authentication required');
export const forbidden = () => new HttpError(403, 'You do not have access to this resource');
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string) => new HttpError(400, msg);
