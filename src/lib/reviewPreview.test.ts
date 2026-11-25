import test from 'node:test';
import assert from 'node:assert/strict';
import { previewReviewComment } from './reviewPreview';

test('review preview leaves reviews with 50 words or fewer complete', () => {
  assert.deepEqual(
    previewReviewComment(Array.from({ length: 49 }, () => 'word').join(' ')),
    { preview: Array.from({ length: 49 }, () => 'word').join(' '), truncated: false },
  );

  const exactly50 = Array.from({ length: 50 }, (_, index) => `word${index + 1}`).join(' ');
  assert.deepEqual(previewReviewComment(exactly50), { preview: exactly50, truncated: false });
});

test('review preview truncates after the 50th word and preserves punctuation and Unicode', () => {
  const words = Array.from({ length: 51 }, (_, index) => index === 49 ? 'শেষ,' : index === 50 ? 'অতিরিক্ত' : `word${index + 1}`);
  const result = previewReviewComment(words.join('  '));

  assert.equal(result.truncated, true);
  assert.equal(result.preview, `${words.slice(0, 50).join('  ')}...`);
});
