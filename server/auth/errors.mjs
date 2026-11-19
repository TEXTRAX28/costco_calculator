const errors = {
  invalid: [400, "Check the highlighted fields and try again."],
  compromised_password: [
    400,
    "Choose a different password. This one has appeared in a known password list.",
  ],
  unsafe_request: [
    403,
    "Open this form from the Gather address and try again.",
  ],
  sign_in_failed: [
    401,
    "Couldn’t sign in. Check your email and password. If you just registered, verify your email first.",
  ],
  session_required: [401, "Your session ended. Sign in to continue."],
  recent_sign_in: [403, "Sign in again before ending all sessions."],
  expired_link: [
    400,
    "This link is invalid or has expired. Request a new one.",
  ],
  external_cancelled: [400, "Google sign-in was cancelled."],
  external_failed: [
    400,
    "Google sign-in couldn’t be completed. Start again from Gather.",
  ],
  throttled: [429, "Too many attempts. Wait a little and try again."],
  unavailable: [
    503,
    "Accounts are temporarily unavailable. You can still use Gather as a guest.",
  ],
  not_found: [404, "This saved entry couldn’t be found."],
  duplicate_receipt_name: [409, "A saved receipt already has this name."],
  save_limit: [409, "Your account’s saved entry limit has been reached."],
};

export class AuthError extends Error {
  constructor(code, field) {
    super(errors[code][1]);
    this.code = code;
    this.status = errors[code][0];
    this.field = field;
  }
}

export function authError(error) {
  return error instanceof AuthError ? error : new AuthError("unavailable");
}
