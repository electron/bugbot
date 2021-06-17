import { Auth, AuthScope } from '../src/auth';

const FAKE_TOKEN = 'xoxo-g0S51pGIr1';

describe('auth', () => {
  it('does not recognize unknown tokens', () => {
    const auth = new Auth();
    expect(auth.tokenHasScopes(FAKE_TOKEN, [])).toBe(false);
  });

  it('recognizes newly-added tokens', () => {
    const auth = new Auth();
    const tokenId = auth.createToken([]);
    expect(auth.tokenHasScopes(tokenId, [])).toBe(true);
  });

  it('successfully revokes known tokens', () => {
    const auth = new Auth();
    const tokenId = auth.createToken([]);
    expect(auth.tokenHasScopes(tokenId, [])).toBe(true); // sanity check
    expect(auth.revokeToken(tokenId)).toBe(true);
  });

  it('does not recognize revoked tokens', () => {
    const auth = new Auth();
    const tokenId = auth.createToken([]);
    expect(auth.tokenHasScopes(tokenId, [])).toBe(true); // sanity check
    expect(auth.revokeToken(tokenId)).toBe(true); // sanity check
    expect(auth.tokenHasScopes(tokenId, [])).toBe(false);
  });

  it('authorizes tokens for only scopes they are granted', () => {
    const auth = new Auth();
    const tokenId = auth.createToken([AuthScope.Jobs]);
    expect(auth.tokenHasScopes(tokenId, [AuthScope.Jobs])).toBe(true);
    expect(auth.tokenHasScopes(tokenId, [AuthScope.ControlTokens])).toBe(false);
  });

  it('does not authorize unknown tokens', () => {
    const auth = new Auth();
    expect(auth.tokenHasScopes(FAKE_TOKEN, [AuthScope.ControlTokens])).toBe(
      false,
    );
  });
});
