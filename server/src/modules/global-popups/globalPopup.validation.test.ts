import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultGlobalPopupDraft } from '../../../../src/lib/globalPromotionalPopup';
import { globalPopupInputSchema, globalPopupTrackSchema } from './globalPopup.validation';

describe('globalPopup Zod validation', () => {
  it('accepts a valid global popup payload and generates clean slug', () => {
    const draft = createDefaultGlobalPopupDraft({
      linkedProductId: '507f1f77bcf86cd799439011',
      name: 'Flagship Watch Mega Launch!',
      slug: '',
    });
    const parsed = globalPopupInputSchema.parse(draft);
    assert.equal(parsed.slug, 'flagship-watch-mega-launch');
    assert.equal(parsed.displayDelaySeconds, 20);
  });

  it('rejects base64 image payloads to prevent storing binaries in MongoDB', () => {
    const draft = createDefaultGlobalPopupDraft({
      linkedProductId: '507f1f77bcf86cd799439011',
    });
    draft.media.desktopImageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';
    assert.throws(() => globalPopupInputSchema.parse(draft), /Base64 images are not allowed/);
  });

  it('rejects unsafe javascript: CTA destinations', () => {
    const draft = createDefaultGlobalPopupDraft({
      linkedProductId: null,
    });
    draft.content.ctaAction = 'external_url';
    draft.content.ctaDestination = 'javascript:alert(1)';
    assert.throws(() => globalPopupInputSchema.parse(draft), /Unsafe URL scheme/);
  });

  it('rejects campaigns where endAt is earlier than or equal to startAt', () => {
    const draft = createDefaultGlobalPopupDraft({
      linkedProductId: '507f1f77bcf86cd799439011',
      startAt: '2026-12-10T10:00:00Z',
      endAt: '2026-12-09T10:00:00Z',
    });
    assert.throws(() => globalPopupInputSchema.parse(draft), /end date\/time must be later/);
  });

  it('requires a linkedProductId when ctaAction is add_to_cart or view_product', () => {
    const draft = createDefaultGlobalPopupDraft({
      linkedProductId: null,
    });
    draft.content.ctaAction = 'add_to_cart';
    assert.throws(() => globalPopupInputSchema.parse(draft), /Linked product is required/);
  });

  it('validates tracking events strictly', () => {
    assert.equal(globalPopupTrackSchema.parse({ event: 'impression' }).event, 'impression');
    assert.equal(globalPopupTrackSchema.parse({ event: 'click' }).event, 'click');
    assert.throws(() => globalPopupTrackSchema.parse({ event: 'hover' }));
  });
});
