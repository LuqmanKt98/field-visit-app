import { describe, it, expect } from 'vitest';
import { haversineDistanceMeters, headingToCardinal } from './geo';

describe('haversineDistanceMeters', () => {
    it('returns 0 for identical points', () => {
        expect(haversineDistanceMeters(37.8199, -122.4783, 37.8199, -122.4783)).toBeCloseTo(0, 1);
    });

    it('matches a known distance (~1.5km across the Golden Gate)', () => {
        const meters = haversineDistanceMeters(37.8085, -122.4750, 37.8305, -122.4791);
        expect(meters).toBeGreaterThan(2300);
        expect(meters).toBeLessThan(2600);
    });
});

describe('headingToCardinal', () => {
    it.each([
        [0, 'N'],
        [44, 'NE'],
        [90, 'E'],
        [180, 'S'],
        [270, 'W'],
        [359, 'N'],
        [-10, 'N'],
    ])('maps %d degrees to %s', (degrees, expected) => {
        expect(headingToCardinal(degrees)).toBe(expected);
    });
});
