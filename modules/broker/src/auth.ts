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

export const enum AuthScope {
  /** Ability to create and revoke tokens. */
  ControlTokens = 'tokens',

  /** Ability to see the list of jobs, create new jobs, and update jobs. */
  Jobs = 'jobs:write',
}

export interface AuthToken {
  id: string;
  scopes: AuthScope[];
}

export class Auth {
  /** The token store. */
  private tokens: AuthToken[];

  public constructor() {
    this.tokens = [];
  }

  /**
   * Creates a new token with the supplied scopes, adds it to the token store,
   * then returns the token's ID.
   */
  public createToken(scopes: AuthScope[]): string {
    // Generate a new UUID for the token
    const id = randomToken();

    // Add the token to the token store
    this.tokens.push({
      id,
      scopes,
    });

    // Return the token's ID
    return id;
  }

  /**
   * Revokes a token from the token store and returns whether the operation was
   * successful or failed (e.g. could not find the token with the given ID).
   */
  public revokeToken(id: string): boolean {
    // Find the token with the given ID
    const idx = this.tokens.findIndex((token) => token.id === id);

    // Ensure a token with the given ID was found
    if (idx === -1) {
      return false;
    }

    // Remove the token from the token store
    this.tokens.splice(idx, 1);
    return true;
  }

  /**
   * Checks that a token with the given ID is registered in the token store and
   * has all of the given scopes.
   */
  public tokenHasScopes(id: string, scopes: AuthScope[]): boolean {
    // Find the token with the given ID
    const token = this.tokens.find((t) => t.id === id);

    // Ensure the token was found
    if (token === undefined) {
      return false;
    }

    // Ensure the token has every scope given
    return scopes.every((scope) => token.scopes.includes(scope));
  }
}
