import { describe, it, expect } from 'vitest';
import { contentTypeMatchesMedia, fileNameFor } from './mediaTypes';

describe('contentTypeMatchesMedia', () => {
    it('accepts image types for photos', () => {
        expect(contentTypeMatchesMedia('photo', 'image/jpeg')).toBe(true);
        expect(contentTypeMatchesMedia('photo', 'image/png')).toBe(true);
    });

    it('accepts both WebM and MP4 for video, since iOS Safari only records MP4', () => {
        expect(contentTypeMatchesMedia('video', 'video/webm')).toBe(true);
        expect(contentTypeMatchesMedia('video', 'video/mp4')).toBe(true);
    });

    it('rejects a video content type submitted as a photo, and vice versa', () => {
        expect(contentTypeMatchesMedia('photo', 'video/mp4')).toBe(false);
        expect(contentTypeMatchesMedia('video', 'image/jpeg')).toBe(false);
    });

    it('rejects arbitrary types', () => {
        expect(contentTypeMatchesMedia('photo', 'application/pdf')).toBe(false);
        expect(contentTypeMatchesMedia('video', 'text/html')).toBe(false);
        expect(contentTypeMatchesMedia('photo', '')).toBe(false);
    });
});

describe('fileNameFor', () => {
    it('names photos by sequence with the right extension', () => {
        expect(fileNameFor('photo', 1, 'image/jpeg')).toBe('photo_1.jpg');
        expect(fileNameFor('photo', 10, 'image/png')).toBe('photo_10.png');
    });

    it('names the video by its recorded container', () => {
        expect(fileNameFor('video', 1, 'video/webm')).toBe('video.webm');
        expect(fileNameFor('video', 1, 'video/mp4')).toBe('video.mp4');
    });

    it('falls back to .bin rather than producing an extensionless key', () => {
        expect(fileNameFor('photo', 2, 'application/octet-stream')).toBe('photo_2.bin');
    });
});
