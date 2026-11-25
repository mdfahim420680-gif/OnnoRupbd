import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEARCH_PLACEHOLDER_CONFIG } from '../../../../src/lib/searchPlaceholder';
import { homepageConfigPatchSchema } from './cmsSettings.validation';

const validPatch = () => ({
  headerSettings: {
    showSearch: true,
    showWishlist: true,
    showCategoryMenu: true,
    stickyHeader: true,
    specialOfferLabel: 'Offers',
    specialOfferUrl: '/offers',
    searchPlaceholder: {
      ...DEFAULT_SEARCH_PLACEHOLDER_CONFIG,
      phrases: DEFAULT_SEARCH_PLACEHOLDER_CONFIG.phrases.map((phrase) => ({ ...phrase })),
    },
  },
});

test('homepage settings accept bounded search placeholder config', () => {
  const parsed = homepageConfigPatchSchema.parse(validPatch());
  assert.equal(parsed.headerSettings?.searchPlaceholder?.typingSpeed, 60);
  assert.equal(parsed.headerSettings?.searchPlaceholder?.phrases.length, 8);
});

test('homepage settings reject empty phrases, unsafe timings, and mass-assigned search fields', () => {
  const emptyPhrasePatch = validPatch();
  emptyPhrasePatch.headerSettings.searchPlaceholder.phrases[0].text = '  ';
  assert.throws(() => homepageConfigPatchSchema.parse(emptyPhrasePatch));

  const invalidTimingPatch = validPatch();
  invalidTimingPatch.headerSettings.searchPlaceholder.typingSpeed = 1;
  assert.throws(() => homepageConfigPatchSchema.parse(invalidTimingPatch));

  const extraFieldPatch = validPatch();
  Object.assign(extraFieldPatch.headerSettings.searchPlaceholder, { updatedBy: 'untrusted' });
  assert.throws(() => homepageConfigPatchSchema.parse(extraFieldPatch));
});

test('homepage social links accept HTTP(S) URLs and reject unsafe schemes', () => {
  const valid = homepageConfigPatchSchema.parse({
    contactInfo: {
      socialLinks: [{
        id: 'facebook-main',
        platform: 'facebook',
        label: 'Facebook',
        url: 'https://facebook.com/novara',
        enabled: true,
        displayOrder: 0,
      }],
    },
  });
  assert.equal(valid.contactInfo?.socialLinks?.[0]?.url, 'https://facebook.com/novara');

  assert.throws(() => homepageConfigPatchSchema.parse({
    contactInfo: {
      socialLinks: [{
        platform: 'instagram',
        label: 'Instagram',
        url: 'javascript:alert(1)',
        enabled: true,
        displayOrder: 0,
      }],
    },
  }));
});
