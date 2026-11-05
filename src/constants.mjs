export const CLI_VERSION = '0.3.0';
export const TARGET_VERSION = '0.78.1';
// send --wait, each relay step, and wait. Login uses LOGIN_WAIT_SEC.
export const DEFAULT_TIMEOUT_SEC = 600;
export const LOGIN_WAIT_SEC = 300;
export const MAX_TIMEOUT_SEC = 3600;
export const START_TTL_SEC = 900;
export const DEFAULT_IDLE_SEC = 2;
export const MAX_RELAY_ROUNDS = 10;
export const WAIT_TRANSCRIPT_LIMIT = 500;
// After assistant text goes quiet, listAgentStatuses is checked at most this often.
export const STATUS_PROBE_INTERVAL_MS = 15_000;
// Last resort if shutdown cleanup leaves the event loop alive. See exit.mjs.
export const EXIT_GRACE_MS = 2_000;

// Public OAuth client id used by the Grok Bot 0.78.1 desktop client.
// Refresh is POST https://api2.cursor.sh/oauth/token.
export const OAUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
export const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token';
// Refresh when exp is missing or inside this 5 minute skew.
export const REFRESH_SKEW_MS = 300_000;
