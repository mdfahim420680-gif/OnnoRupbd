import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OAUTH_BROADCAST_CHANNEL,
  openOAuthPopupWindow,
  subscribeOAuthPopupEvents,
  type OAuthPopupEvent,
} from './oauthPopup.ts';

describe('NOVARA OAuth popup communication helper', () => {
  it('opens centered popup without noopener/noreferrer flags so window.opener stays intact', () => {
    const origWindow = (globalThis as Record<string, unknown>).window;
    const origDocument = (globalThis as Record<string, unknown>).document;
    const origScreen = (globalThis as Record<string, unknown>).screen;

    let capturedUrl = '';
    let capturedName = '';
    let capturedFeatures = '';
    const fakePopup = { closed: false } as unknown as Window;

    try {
      (globalThis as Record<string, unknown>).document = {
        documentElement: { clientWidth: 1280, clientHeight: 800 },
      };
      (globalThis as Record<string, unknown>).screen = { width: 1280, height: 800 };
      (globalThis as Record<string, unknown>).window = {
        screenLeft: 0,
        screenTop: 0,
        innerWidth: 1280,
        innerHeight: 800,
        open: (url: string, name: string, features: string) => {
          capturedUrl = url;
          capturedName = name;
          capturedFeatures = features;
          return fakePopup;
        },
      };

      const popup = openOAuthPopupWindow('https://accounts.google.com/o/oauth2/v2/auth?x=1', 'novara_google_oauth');
      assert.equal(popup, fakePopup);
      assert.equal(capturedUrl, 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
      assert.equal(capturedName, 'novara_google_oauth');
      assert.match(capturedFeatures, /width=520/);
      assert.match(capturedFeatures, /height=640/);
      assert.doesNotMatch(capturedFeatures, /noopener/i);
      assert.doesNotMatch(capturedFeatures, /noreferrer/i);
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
      (globalThis as Record<string, unknown>).document = origDocument;
      (globalThis as Record<string, unknown>).screen = origScreen;
    }
  });

  it('validates postMessage origin/source and falls back cleanly to BroadcastChannel', async () => {
    const origWindow = (globalThis as Record<string, unknown>).window;
    const origBroadcastChannel = (globalThis as Record<string, unknown>).BroadcastChannel;

    const listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
    const popupWindow = { closed: false } as unknown as Window;
    const otherWindow = { closed: false } as unknown as Window;
    const createdChannels: MockBroadcastChannel[] = [];

    class MockBroadcastChannel {
      name: string;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      closed = false;
      constructor(name: string) {
        this.name = name;
        createdChannels.push(this);
      }
      close() {
        this.closed = true;
      }
    }

    try {
      (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
      (globalThis as Record<string, unknown>).window = {
        location: { origin: 'https://ais-dev-example.asia-east1.run.app' },
        addEventListener: (type: string, fn: (ev: MessageEvent) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: (ev: MessageEvent) => void) => {
          listeners.get(type)?.delete(fn);
        },
      };

      const received: OAuthPopupEvent[] = [];
      const unsubscribe = subscribeOAuthPopupEvents({
        popupRef: { current: popupWindow },
        onEvent: (ev) => {
          received.push(ev);
        },
      });

      const msgListeners = Array.from(listeners.get('message') || []);
      assert.equal(msgListeners.length, 1);

      // Untrusted origin ignored
      msgListeners[0]({
        origin: 'https://evil.example.com',
        source: popupWindow,
        data: { type: 'OAUTH_AUTH_SUCCESS', provider: 'google', exchangeCode: 'bad' },
      } as unknown as MessageEvent);

      // Untrusted source window ignored
      msgListeners[0]({
        origin: 'https://ais-dev-example.asia-east1.run.app',
        source: otherWindow,
        data: { type: 'OAUTH_AUTH_SUCCESS', provider: 'google', exchangeCode: 'wrong-source' },
      } as unknown as MessageEvent);

      // Legitimate postMessage accepted
      msgListeners[0]({
        origin: 'https://ais-dev-example.asia-east1.run.app',
        source: popupWindow,
        data: {
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'google',
          exchangeCode: 'valid-exchange-1',
          targetOrigin: 'https://ais-dev-example.asia-east1.run.app',
        },
      } as unknown as MessageEvent);

      assert.equal(received.length, 1);
      assert.equal(received[0].type, 'OAUTH_AUTH_SUCCESS');

      // BroadcastChannel delivery also works when targetOrigin matches
      assert.equal(createdChannels.length, 1);
      const activeChannel = createdChannels[0];
      assert.equal(activeChannel.name, OAUTH_BROADCAST_CHANNEL);
      activeChannel.onmessage?.({
        data: {
          type: 'OAUTH_AUTH_ERROR',
          provider: 'google',
          error: 'Cancelled',
          targetOrigin: 'https://other-origin.example.com',
        },
      } as MessageEvent);
      assert.equal(received.length, 1, 'Mismatched targetOrigin on BroadcastChannel must be ignored');

      activeChannel.onmessage?.({
        data: {
          type: 'OAUTH_AUTH_ERROR',
          provider: 'google',
          error: 'Cancelled',
          targetOrigin: 'https://ais-dev-example.asia-east1.run.app',
        },
      } as MessageEvent);
      assert.equal(received.length, 2);
      assert.equal(received[1].type, 'OAUTH_AUTH_ERROR');

      unsubscribe();
      assert.equal(listeners.get('message')?.size, 0);
      assert.equal(activeChannel.closed, true);
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
      (globalThis as Record<string, unknown>).BroadcastChannel = origBroadcastChannel;
    }
  });
});
