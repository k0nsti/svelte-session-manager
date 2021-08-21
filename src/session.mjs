import { JSONContentTypeHeader } from "./constants.mjs";

/**
 * Data as preserved in the backing store.
 * @typedef {Object} SessionData
 * @property {string} username user name (id)
 * @property {string} access_token JWT token
 * @property {string} refresh_token JWT token
 */
const storeKeys = ["username", "access_token", "refresh_token"];

function copy(destination, source) {
  for (const key of storeKeys) {
    if (source == undefined || source[key] === undefined) {
      destination[key] = undefined;
    } else {
      destination[key] = source[key];
    }
  }
}

/**
 * User session.
 * To create as session backed by browser local storage.
 * ```js
 * let session = new Session(localStorage);
 * ```
 * or by browser session storage
 * ```js
 * let session = new Session(sessionStorage);
 * ```
 * @param {SessionData} data
 * @property {Set<string>} entitlements
 * @property {Set<Object>} subscriptions store subscriptions
 * @property {Date} expirationDate when the access token expires
 * @property {string} access_token token itself
 * @property {string} refresh_token refresh token
 */
export class Session {
  constructor(store = localStorage) {
    let expirationTimer;

    Object.defineProperties(this, {
      subscriptions: {
        value: new Set()
      },
      entitlements: {
        value: new Set()
      },
      expirationDate: {
        value: new Date(0)
      },
      expirationTimer: {
        get: () => expirationTimer,
        set: v => (expirationTimer = v)
      },
      ...Object.fromEntries(storeKeys.map(key => [
        key,
        {
          get: () => store[key],
          set: v => {
            if (v === undefined) {
              delete store[key];
            } else {
              store[key] = v;
            }
            this.emit();
          }
        }
      ]))
    });

    this.update(store);
  }

  /**
   * Consume data and reflect internal state.
   * @param {object} data
   */
  update(data) {
    if (data !== undefined) {
      if (data.endpoint) {
        this.endpoint = data.endpoint;
      }

      copy(this, data);

      const decoded = decode(data.access_token);

      if (decoded) {
        this.expirationDate.setUTCSeconds(decoded.exp);

        const expiresInMilliSeconds =
          this.expirationDate.valueOf() - Date.now();

        if (expiresInMilliSeconds > 0) {
          if (decoded.entitlements) {
            decoded.entitlements
              .split(/,/)
              .forEach(e => this.entitlements.add(e));
          }

          this.expirationTimer = setTimeout(async () => {
            if (!(await this.refresh())) {
              this.invalidate();
            }
          }, expiresInMilliSeconds);

          return;
        }
      }
    }
    this.invalidate();
  }

  /**
   * Refresh with refresh_token.
   * @return {boolean} true if refresh was succcessfull false otherwise
   */
  async refresh() {
    if (this.refresh_token) {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: JSONContentTypeHeader,
        body: JSON.stringify({
          refresh_token: this.refresh_token,
          grant_type: "refresh_token"
        })
      });
      if (response.ok) {
        this.update(await response.json());
        return true;
      }
    }

    return false;
  }

  /**
   * Http header suitable for fetch.
   * @return {Object} header The http header.
   * @return {string} header.Authorization The Bearer access token.
   */
  get authorizationHeader() {
    return this.isValid ? { Authorization: "Bearer " + this.access_token } : {};
  }

  /**
   * As long as the expirationTimer is running we must be valid.
   * @return {boolean} true if session is valid (not expired)
   */
  get isValid() {
    return this.expirationTimer !== undefined;
  }

  /**
   * Remove all tokens from the session and the backing store.
   */
  invalidate() {
    this.expirationDate.setTime(0);
    this.entitlements.clear();

    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = undefined;
    }

    copy(this);
  }

  /**
   * Check presence of an entitlement.
   * @param {string} name of the entitlement
   * @return {boolean} true if the named entitlement is present
   */
  hasEntitlement(name) {
    return this.entitlements.has(name);
  }

  emit() {
    this.subscriptions.forEach(subscription => subscription(this));
  }

  /**
   * Fired when the session changes.
   * @param {Function} subscription
   */
  subscribe(subscription) {
    subscription(this);
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }
}

/**
 * Extract and decode the payload.
 * @param {string} token
 * @return {object} payload object
 */
function decode(token) {
  if (token === undefined) {
    return undefined;
  }

  const payload = token.split(".")[1];

  return payload === undefined ? undefined : JSON.parse(atob(payload));
}
