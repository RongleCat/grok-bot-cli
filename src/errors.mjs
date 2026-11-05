import { SDKError } from 'grok-bot-sdk';

export class CliError extends Error {
  constructor(code, message, exitCode = 4, extra = undefined) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.extra = extra;
  }
}

const ARG_CODES = new Set([
  'MESSAGE_INVALID',
  'BOT_ID_REQUIRED',
  'CURSOR_INVALID',
  'CURSOR_SCOPE_MISMATCH',
]);

export function isUnauthorized(error) {
  return error instanceof SDKError && error.httpStatus === 401;
}

export function normalizeError(error) {
  if (error instanceof CliError) return error;
  if (error instanceof SDKError) {
    if (error.httpStatus === 401 || error.code === 'MISSING_ACCESS_TOKEN') {
      return new CliError('NOT_LOGGED_IN', 'Credentials were rejected. Run: grok-bot login', 2);
    }
    if (ARG_CODES.has(error.code)) {
      return new CliError(error.code, `${error.code}. Check the command flags.`, 3);
    }
    if (error.code === 'SEND_REFUSED') {
      return new CliError('SEND_REFUSED', 'The server refused the message.', 4);
    }
    if (error.code === 'NOT_A_ROOM') {
      return new CliError('NOT_A_ROOM', 'That id is not a room.', 3);
    }
    if (error.httpStatus === 408) {
      return new CliError('TIMEOUT', 'The request timed out.', 5);
    }
    if (error.code === 'ACCOUNT_AUTH_FAILED') {
      return new CliError('ACCOUNT_AUTH_FAILED', 'The account request was rejected.', 4);
    }
    return new CliError(error.code || 'RPC_FAILED', 'The request failed.', 4);
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new CliError('TIMEOUT', 'The request timed out.', 5);
  }
  return new CliError('NETWORK', 'The request failed.', 4);
}
