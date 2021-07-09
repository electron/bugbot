import { randomBytes } from 'crypto';

/**
 * Creates a random token.
 */
function randomToken(): string {
  const TOKEN_VERSION = 1;
  return Buffer.concat([
    Buffer.from(new Uint8Array([TOKEN_VERSION])),
    randomBytes(63),
  ]).toString('base64url');
}

export enum AuthScope {
  /** Ability to create and revoke tokens. */
  ControlTokens = 'tokens',

  /** Ability to create new jobs. */
  CreateJobs = 'jobs:create',

  /** Ability to update existing jobs. */
  UpdateJobs = 'jobs:update',

  // NOTE: when adding more scopes, make sure to include them in the
  // `ALL_SCOPES` array below.
}

// TODO: perhaps having a "glob" matching system would help, e.g. `jobs:*` or
// simply `*`
export const ALL_SCOPES = [
  AuthScope.ControlTokens,
  AuthScope.CreateJobs,
  AuthScope.UpdateJobs,
];

/**
 * Data about an authorization through the security layer.
 */
interface AuthData {
  /** Authentication token. */
  token: string;

  /** Allowed scopes. */
  scopes: Set<AuthScope>;
}

/**
 * Stores information about authorizations through the security layer. Queries
 * can be made about those authorizations to enable authentication.
 */
export class Auth {
  /**
   * The token store, mapped from token to an auth data object.
   */
  private tokens: Map<string, AuthData> = new Map();

  /**
   * Generates a new auth data object with the supplied scopes, adds it to the
   * token store, then returns the token.
   */
  public createToken(scopes: AuthScope[], authToken?: string): string {
    // Use the given token or generate one
    const token = authToken ?? randomToken();

    // Add a token object to the token store
    this.tokens.set(token, {
      scopes: new Set(scopes),
      token,
    });

    // Return the token
    return token;
  }

  /**
   * Revokes a token from the token store and returns whether the operation was
   * successful or failed (e.g. could not find the token).
   */
  public revokeToken(token: string): boolean {
    return this.tokens.delete(token);
  }

  /**
   * Checks that a token is registered in the token store and has *all* of the
   * given scopes.
   */
  public tokenHasScopes(token: string, scopes: AuthScope[]): boolean {
    // Find the token from the token store
    const authObj = this.tokens.get(token);

    // Ensure the token object was found
    if (authObj === undefined) {
      return false;
    }

    // Ensure the token object has every scope given
    return scopes.every((scope) => authObj.scopes.has(scope));
  }
}
