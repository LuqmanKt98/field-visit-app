import { describe, it, expect } from 'vitest';
import { fileNameFor } from './mediaTypes';

/**
 * Regression cover for the defect where /media/confirm accepted a caller-supplied S3
 * key and only prefix-checked it, so a single uploaded photo could be confirmed under
 * all ten sequence numbers and once more as the video -- marking the task Completed
 * with one object in the bucket.
 *
 * The route now derives the key with fileNameFor(). These assert the property that
 * makes the attack impossible: every (mediaType, sequenceNumber) slot maps to its own
 * distinct object, so ten confirms require ten genuinely distinct uploads.
 */
describe('derived media keys are distinct per slot', () => {
    const taskId = '345667896';
    const keyFor = (mediaType: 'photo' | 'video', seq: number, contentType: string) =>
        `${taskId}/${fileNameFor(mediaType, seq, contentType)}`;

    it('gives all ten photos different keys', () => {
        const keys = Array.from({ length: 10 }, (_, i) => keyFor('photo', i + 1, 'image/jpeg'));
        expect(new Set(keys).size).toBe(10);
    });

    it('never lets the video collide with a photo', () => {
        const photoKeys = Array.from({ length: 10 }, (_, i) => keyFor('photo', i + 1, 'image/jpeg'));
        const videoKey = keyFor('video', 1, 'video/webm');
        expect(photoKeys).not.toContain(videoKey);
    });

    it('is deterministic, so a retake overwrites its own slot rather than creating a new one', () => {
        expect(keyFor('photo', 3, 'image/jpeg')).toBe(keyFor('photo', 3, 'image/jpeg'));
    });

    it('keeps every derived key inside the task folder', () => {
        const keys = [
            ...Array.from({ length: 10 }, (_, i) => keyFor('photo', i + 1, 'image/jpeg')),
            keyFor('video', 1, 'video/mp4'),
        ];
        for (const key of keys) {
            expect(key.startsWith(`${taskId}/`)).toBe(true);
            expect(key).not.toContain('..');
        }
    });
});
