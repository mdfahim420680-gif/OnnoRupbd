import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env, integrations } from '../../config/env';
import { createExpressApp } from '../../app';
import { signAuthToken } from '../../middleware/auth.middleware';
import { UserModel } from '../users/user.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { AuthSessionModel, UserAuthProviderModel } from './authIdentity.model';
import {
  confirmOAuthLinkAccount,
  resolveOrChallengeOAuthUser,
  unlinkProviderForUser,
} from './auth.service';
import { resetOAuthRuntimeCachesForTests } from './oauth.service';

async function withHttpServer(fn: (baseUrl: string) => Promise<void>) {
  const app = createExpressApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function withMockReadyDb(fn: () => Promise<void>) {
  const desc = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  try {
    await fn();
  } finally {
    if (desc) {
      Object.defineProperty(mongoose.connection, 'readyState', desc);
    } else {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    }
  }
}

function chainableQuery<T>(result: T) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
}

test('GET /api/auth/providers returns 200 without DB and includes Dev + Shared Cloud Run callback URLs', async () => {
  await withHttpServer(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/auth/providers`);
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      providers: {
        emailPassword: boolean;
        google: boolean;
        facebook: boolean;
        googleConfigured: boolean;
        facebookConfigured: boolean;
      };
      callbacks: {
        google: { devCallbackUrl: string; sharedCallbackUrl: string };
        facebook: { devCallbackUrl: string; sharedCallbackUrl: string };
      };
      branding: { effectiveBrandName: string; loginTitle: string };
    };

    const devOrigin = env.APP_URL.replace(/\/$/, '');
    const expectedSharedOrigin = devOrigin.includes('ais-dev-')
      ? devOrigin.replace('ais-dev-', 'ais-pre-')
      : env.CLIENT_URL && env.CLIENT_URL !== devOrigin
        ? env.CLIENT_URL.replace(/\/$/, '')
        : devOrigin;

    assert.equal(body.ok, true);
    assert.equal(body.providers.emailPassword, true);
    assert.equal(typeof body.providers.googleConfigured, 'boolean');
    assert.equal(typeof body.providers.facebookConfigured, 'boolean');
    assert.equal(body.callbacks.google.devCallbackUrl, `${devOrigin}/api/auth/oauth/google/callback`);
    assert.equal(body.callbacks.google.sharedCallbackUrl, `${expectedSharedOrigin}/api/auth/oauth/google/callback`);
    assert.equal(body.callbacks.facebook.devCallbackUrl, `${devOrigin}/api/auth/oauth/facebook/callback`);
    assert.equal(body.callbacks.facebook.sharedCallbackUrl, `${expectedSharedOrigin}/api/auth/oauth/facebook/callback`);
    assert.ok(body.branding.effectiveBrandName.length > 0);
  });
});

test('POST /api/auth/identify normalizes valid email and returns HTTP 400 for malformed email without enumeration', async () => {
  await withHttpServer(async (baseUrl) => {
    const validResp = await fetch(`${baseUrl}/api/auth/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Alex.Customer@Example.COM  ' }),
    });
    assert.equal(validResp.status, 200);
    const validBody = (await validResp.json()) as { ok: boolean; email: string; step: string };
    assert.equal(validBody.ok, true);
    assert.equal(validBody.email, 'alex.customer@example.com');
    assert.equal(validBody.step, 'credentials');

    const badResp = await fetch(`${baseUrl}/api/auth/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(badResp.status, 400);
  });
});

test('OAuth safe account linking requires explicit password confirmation instead of silent auto-linking', async () => {
  const passwordHash = await bcrypt.hash('NovaraPass123', 6);
  const localUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Tasnim Rahman',
    givenName: 'Tasnim',
    familyName: 'Rahman',
    email: 'tasnim@example.com',
    role: 'customer',
    status: 'active',
    isVerified: true,
    passwordHash,
    authProvider: 'local',
    initialAuthProvider: 'local',
    oauthProviders: {} as { googleId?: string; facebookId?: string },
    avatarUrl: '',
    avatarSources: { google: '', facebook: '', uploaded: '' },
    saveCalled: false,
    async save() {
      this.saveCalled = true;
      return this;
    },
  };

  const origFindOne = UserModel.findOne;
  const origFindById = UserModel.findById;

  try {
    (UserModel as unknown as Record<string, unknown>).findOne = (query: Record<string, unknown>) => {
      if ('oauthProviders.googleId' in query) {
        return chainableQuery(
          localUser.oauthProviders.googleId === query['oauthProviders.googleId'] ? localUser : null,
        );
      }
      if (query.email === 'tasnim@example.com') {
        return chainableQuery(localUser);
      }
      return chainableQuery(null);
    };
    (UserModel as unknown as Record<string, unknown>).findById = (id: string) =>
      chainableQuery(id === localUser._id ? localUser : null);

    // Step 1: OAuth sign-in matching existing local email must NOT auto-link; returns link_required
    const challenge = await resolveOrChallengeOAuthUser({
      provider: 'google',
      providerId: 'google-sub-999',
      email: 'tasnim@example.com',
      name: 'Tasnim Rahman',
      picture: 'https://lh3.googleusercontent.com/a/photo',
      emailVerified: true,
    });

    assert.equal(challenge.status, 'link_required');
    if (challenge.status !== 'link_required') throw new Error('Expected link_required');
    assert.equal(challenge.provider, 'google');
    assert.equal(challenge.existingHasPassword, true);
    assert.equal(challenge.existingInitialProvider, 'local');
    assert.equal(localUser.saveCalled, false);

    // Step 2: Wrong password rejects linking cleanly
    await assert.rejects(
      confirmOAuthLinkAccount({
        linkToken: challenge.pendingLinkToken,
        password: 'WrongPassword99',
      }),
      /Incorrect password/,
    );
    assert.equal(localUser.oauthProviders.googleId, undefined);

    // Step 3: Correct password links Google while preserving initialAuthProvider: 'local'
    const linked = await confirmOAuthLinkAccount({
      linkToken: challenge.pendingLinkToken,
      password: 'NovaraPass123',
    });

    assert.equal(localUser.saveCalled, true);
    assert.equal(localUser.oauthProviders.googleId, 'google-sub-999');
    assert.equal(linked.user.initialAuthProvider, 'local');
    assert.equal(linked.user.linkedProviders?.google, true);
    assert.equal(linked.user.linkedProviders?.local, true);
    assert.ok(linked.token.length > 20);
  } finally {
    UserModel.findOne = origFindOne;
    UserModel.findById = origFindById;
  }
});

test('unlinkProviderForUser blocks unlinking the last sign-in method and allows unlinking when another method exists', async () => {
  const socialOnlyUser = {
    _id: '507f1f77bcf86cd799439022',
    name: 'Google Buyer',
    email: 'buyer@example.com',
    role: 'customer',
    status: 'active',
    isVerified: true,
    passwordHash: undefined as string | undefined,
    initialAuthProvider: 'google',
    oauthProviders: { googleId: 'g-only' } as { googleId?: string; facebookId?: string },
    avatarUrl: 'https://lh3.googleusercontent.com/a/g-only',
    avatarSources: { google: 'https://lh3.googleusercontent.com/a/g-only', facebook: '', uploaded: '' },
    async save() {
      return this;
    },
  };

  const origFindById = UserModel.findById;
  try {
    (UserModel as unknown as Record<string, unknown>).findById = () => chainableQuery(socialOnlyUser);

    await assert.rejects(
      unlinkProviderForUser(socialOnlyUser._id, 'google'),
      /before unlinking your only sign-in method/,
    );

    // Adding a password enables safe unlinking
    socialOnlyUser.passwordHash = 'hashed-pw';
    const serialized = await unlinkProviderForUser(socialOnlyUser._id, 'google');
    assert.equal(serialized.linkedProviders?.google, false);
    assert.equal(serialized.linkedProviders?.local, true);
    assert.equal(serialized.initialAuthProvider, 'google');
  } finally {
    UserModel.findById = origFindById;
  }
});

test('authenticateRequired rejects revoked AuthSession tokens and admin analytics requires admin permission', async () => {
  const origSessionFindOne = AuthSessionModel.findOne;
  const origUserFindById = UserModel.findById;
  const origProviderFind = UserAuthProviderModel.find;

  try {
    await withMockReadyDb(async () => {
      const revokedSid = 'sid-revoked-001';
      const activeSid = 'sid-active-002';

      (AuthSessionModel as unknown as Record<string, unknown>).findOne = ({ sessionId }: { sessionId: string }) =>
        chainableQuery(
          sessionId === revokedSid
            ? { sessionId: revokedSid, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }
            : { sessionId: activeSid, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date() },
        );

      const customerDoc = {
        _id: '507f1f77bcf86cd799439033',
        name: 'Regular Customer',
        email: 'customer@example.com',
        role: 'customer',
        status: 'active',
        isVerified: true,
        customPermissions: [],
      };
      (UserModel as unknown as Record<string, unknown>).findById = () => chainableQuery(customerDoc);

      const revokedJwt = signAuthToken(
        { _id: customerDoc._id, role: 'customer', email: customerDoc.email },
        { sessionId: revokedSid },
      );
      const activeCustomerJwt = signAuthToken(
        { _id: customerDoc._id, role: 'customer', email: customerDoc.email },
        { sessionId: activeSid },
      );

      await withHttpServer(async (baseUrl) => {
        // Revoked session rejected with 401 SESSION_REVOKED
        const revResp = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${revokedJwt}` },
        });
        assert.equal(revResp.status, 401);
        const revBody = (await revResp.json()) as { code: string };
        assert.equal(revBody.code, 'SESSION_REVOKED');

        // Unauthenticated admin analytics call returns 401
        const unauthAdmin = await fetch(`${baseUrl}/api/admin/users/authentication-stats`);
        assert.equal(unauthAdmin.status, 401);

        // Customer role calling admin analytics returns 403 FORBIDDEN
        const forbiddenAdmin = await fetch(`${baseUrl}/api/admin/users/authentication-stats`, {
          headers: { Authorization: `Bearer ${activeCustomerJwt}` },
        });
        assert.equal(forbiddenAdmin.status, 403);
      });
    });
  } finally {
    AuthSessionModel.findOne = origSessionFindOne;
    UserModel.findById = origUserFindById;
    UserAuthProviderModel.find = origProviderFind;
  }
});

test('Express app sets COOP same-origin-allow-popups and Google OAuth popup flow exchanges code without relying on 3P cookies', async () => {
  resetOAuthRuntimeCachesForTests();
  const origClientId = env.GOOGLE_CLIENT_ID;
  const origClientSecret = env.GOOGLE_CLIENT_SECRET;
  const origGoogleFlag = integrations.googleOAuth;
  const origFetch = globalThis.fetch;
  const origFindOne = UserModel.findOne;
  const origFindById = UserModel.findById;
  const origCreate = UserModel.create;
  const origSessionCreate = AuthSessionModel.create;
  const origSessionFindOne = AuthSessionModel.findOne;
  const origProviderUpsert = UserAuthProviderModel.findOneAndUpdate;
  const origProviderFindOne = UserAuthProviderModel.findOne;
  const origHomepageFindOne = HomepageConfigModel.findOne;

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'int-test-kid', use: 'sig', alg: 'RS256' };

  let createdUserDoc: Record<string, unknown> | null = null;
  let capturedOidcNonce = '';

  try {
    env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    integrations.googleOAuth = true;

    await withMockReadyDb(async () => {
      (AuthSessionModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => doc;
      (AuthSessionModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (HomepageConfigModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (UserAuthProviderModel as unknown as Record<string, unknown>).findOneAndUpdate = async () => null;
      (UserAuthProviderModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (UserModel as unknown as Record<string, unknown>).findOne = (query: Record<string, unknown>) => {
        if (createdUserDoc && ('oauthProviders.googleId' in query || query.email === createdUserDoc.email)) {
          return chainableQuery(createdUserDoc);
        }
        return chainableQuery(null);
      };
      (UserModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => {
        createdUserDoc = {
          ...doc,
          _id: '507f1f77bcf86cd799439055',
          createdAt: new Date(),
          async save() {
            return this;
          },
        };
        return createdUserDoc;
      };
      (UserModel as unknown as Record<string, unknown>).findById = (id: string) =>
        chainableQuery(createdUserDoc && String(createdUserDoc._id) === id ? createdUserDoc : null);

      await withHttpServer(async (baseUrl) => {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (url === 'https://oauth2.googleapis.com/token') {
            const nowSec = Math.floor(Date.now() / 1000);
            const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'int-test-kid' })).toString('base64url');
            const payload = Buffer.from(
              JSON.stringify({
                iss: 'https://accounts.google.com',
                aud: 'test-google-client-id',
                sub: 'google-sub-integration-001',
                email: 'new.google.buyer@example.com',
                email_verified: true,
                name: 'Aria Chowdhury',
                given_name: 'Aria',
                family_name: 'Chowdhury',
                picture: 'https://lh3.googleusercontent.com/a/aria.jpg',
                nonce: capturedOidcNonce,
                iat: nowSec - 5,
                exp: nowSec + 3600,
              }),
            ).toString('base64url');
            const sig = crypto.sign('RSA-SHA256', Buffer.from(`${hdr}.${payload}`), privateKey).toString('base64url');
            return new Response(JSON.stringify({ access_token: 'g-access-token', id_token: `${hdr}.${payload}.${sig}` }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return origFetch(input, init);
        }) as typeof fetch;

        const parentOrigin = 'https://ais-pre-rfsgp7gp6dmesozie5iri6-322176138228.asia-east1.run.app';
        const urlResp = await origFetch(
          `${baseUrl}/api/auth/oauth/google/url?returnTo=${encodeURIComponent('/')}&parentOrigin=${encodeURIComponent(parentOrigin)}`,
        );
        assert.equal(urlResp.status, 200);
        assert.equal(urlResp.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');

        const urlData = (await urlResp.json()) as { ok: boolean; url: string; flowVerifier: string };
        assert.equal(urlData.ok, true);
        assert.ok(urlData.flowVerifier.length >= 32);

        const googleAuthUrl = new URL(urlData.url);
        const stateToken = googleAuthUrl.searchParams.get('state') || '';
        capturedOidcNonce = googleAuthUrl.searchParams.get('nonce') || '';
        assert.ok(stateToken.length > 20);
        assert.ok(capturedOidcNonce.length > 20);

        // Simulate popup callback arriving WITHOUT the OAuth state cookie (3P cookie partitioned/blocked in iframe)
        const callbackResp = await origFetch(
          `${baseUrl}/api/auth/oauth/google/callback?code=auth-code-xyz&state=${encodeURIComponent(stateToken)}`,
        );
        assert.equal(callbackResp.status, 200);
        assert.equal(callbackResp.headers.get('cross-origin-opener-policy'), 'unsafe-none');
        const setCookieHeaders = callbackResp.headers.getSetCookie?.() || [];
        assert.equal(
          setCookieHeaders.some((c) => c.startsWith('novara_token=')),
          false,
          'Callback without state cookie must defer novara_token cookie to exchange endpoint',
        );

        const html = await callbackResp.text();
        assert.match(html, /OAUTH_AUTH_SUCCESS/);
        assert.match(html, /BroadcastChannel\('novara_oauth_channel'\)/);
        assert.match(html, /window\.opener\.postMessage/);
        assert.match(html, /window\.close/);

        // Extract serialized msg JSON from callback HTML
        const msgMatch = html.match(/var msg = (\{.*?\});/);
        assert.ok(msgMatch, 'Expected embedded OAuth message payload in callback HTML');
        const parsedMsg = JSON.parse(msgMatch[1]) as {
          type: string;
          provider: string;
          exchangeCode?: string;
          targetOrigin: string;
          returnTo: string;
        };
        assert.equal(parsedMsg.type, 'OAUTH_AUTH_SUCCESS');
        assert.equal(parsedMsg.provider, 'google');
        assert.equal(parsedMsg.targetOrigin, parentOrigin);
        assert.equal(parsedMsg.returnTo, '/');
        assert.ok(parsedMsg.exchangeCode && parsedMsg.exchangeCode.length > 30);

        // Untrusted origin rejected by /api/auth/oauth/exchange
        const badOriginExchange = await origFetch(`${baseUrl}/api/auth/oauth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://malicious.example.com',
          },
          body: JSON.stringify({
            exchangeCode: parsedMsg.exchangeCode,
            flowVerifier: urlData.flowVerifier,
          }),
        });
        assert.equal(badOriginExchange.status, 403);

        // Wrong flowVerifier rejected without consuming exchangeCode
        const wrongVerifierExchange = await origFetch(`${baseUrl}/api/auth/oauth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: parentOrigin,
          },
          body: JSON.stringify({
            exchangeCode: parsedMsg.exchangeCode,
            flowVerifier: 'wrong-verifier-0000000000000000',
          }),
        });
        assert.equal(wrongVerifierExchange.status, 403);

        // Valid exchange succeeds, sets novara_token cookie on parent origin response, and returns authenticated user + JWT
        const validExchange = await origFetch(`${baseUrl}/api/auth/oauth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: parentOrigin,
          },
          body: JSON.stringify({
            exchangeCode: parsedMsg.exchangeCode,
            flowVerifier: urlData.flowVerifier,
          }),
        });
        assert.equal(validExchange.status, 200);
        const exchangeCookies = validExchange.headers.getSetCookie?.() || [];
        assert.ok(exchangeCookies.some((c) => c.startsWith('novara_token=') && !c.startsWith('novara_token=;')));
        const exchangeBody = (await validExchange.json()) as {
          ok: boolean;
          user: { email: string; name: string; role: string; isVerified: boolean; initialAuthProvider: string };
          token: string;
          returnTo: string;
        };
        assert.equal(exchangeBody.ok, true);
        assert.equal(exchangeBody.user.email, 'new.google.buyer@example.com');
        assert.equal(exchangeBody.user.role, 'customer');
        assert.equal(exchangeBody.user.isVerified, true);
        assert.equal(exchangeBody.user.initialAuthProvider, 'google');
        assert.equal(exchangeBody.returnTo, '/');
        assert.ok(exchangeBody.token.length > 20);

        // Replaying consumed exchangeCode is rejected with 409
        const replayExchange = await origFetch(`${baseUrl}/api/auth/oauth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: parentOrigin,
          },
          body: JSON.stringify({
            exchangeCode: parsedMsg.exchangeCode,
            flowVerifier: urlData.flowVerifier,
          }),
        });
        assert.equal(replayExchange.status, 409);

        // Cancelled OAuth flow emits OAUTH_AUTH_ERROR HTML in popup mode with unsafe-none COOP
        const cancelInit = await origFetch(`${baseUrl}/api/auth/oauth/google/url?returnTo=/&parentOrigin=${encodeURIComponent(parentOrigin)}`);
        const cancelData = (await cancelInit.json()) as { url: string };
        const cancelState = new URL(cancelData.url).searchParams.get('state') || '';
        const cancelCallback = await origFetch(
          `${baseUrl}/api/auth/oauth/google/callback?error=access_denied&state=${encodeURIComponent(cancelState)}`,
        );
        assert.equal(cancelCallback.status, 200);
        assert.equal(cancelCallback.headers.get('cross-origin-opener-policy'), 'unsafe-none');
        const cancelHtml = await cancelCallback.text();
        assert.match(cancelHtml, /OAUTH_AUTH_ERROR/);
        assert.match(cancelHtml, /Google sign-in was cancelled/);
      });
    });
  } finally {
    env.GOOGLE_CLIENT_ID = origClientId;
    env.GOOGLE_CLIENT_SECRET = origClientSecret;
    integrations.googleOAuth = origGoogleFlag;
    globalThis.fetch = origFetch;
    UserModel.findOne = origFindOne;
    UserModel.findById = origFindById;
    UserModel.create = origCreate;
    AuthSessionModel.create = origSessionCreate;
    AuthSessionModel.findOne = origSessionFindOne;
    UserAuthProviderModel.findOneAndUpdate = origProviderUpsert;
    UserAuthProviderModel.findOne = origProviderFindOne;
    HomepageConfigModel.findOne = origHomepageFindOne;
    resetOAuthRuntimeCachesForTests();
  }
});

test('POST /api/auth/oauth/confirm-link accepts Shared AI Studio runtime origin and blocks untrusted origins', async () => {
  await withMockReadyDb(async () => {
    await withHttpServer(async (baseUrl) => {
      const untrusted = await fetch(`${baseUrl}/api/auth/oauth/confirm-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        body: JSON.stringify({ linkToken: 'x'.repeat(24), password: 'Password123' }),
      });
      assert.equal(untrusted.status, 403);
      const untrustedBody = (await untrusted.json()) as { code: string };
      assert.equal(untrustedBody.code, 'CSRF_VALIDATION_FAILED');

      const sharedOrigin = await fetch(`${baseUrl}/api/auth/oauth/confirm-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://ais-pre-rfsgp7gp6dmesozie5iri6-322176138228.asia-east1.run.app',
        },
        body: JSON.stringify({ linkToken: 'invalid-short-token-over-20-chars', password: 'Password123' }),
      });
      // Passes CSRF origin verification and reaches token validation (400 INVALID_LINK_TOKEN)
      assert.equal(sharedOrigin.status, 400);
      const sharedBody = (await sharedOrigin.json()) as { code: string };
      assert.equal(sharedBody.code, 'INVALID_LINK_TOKEN');
    });
  });
});

