import { describe, it, expect } from 'vitest';
import { isValidTaskId } from './taskId';

describe('isValidTaskId', () => {
    it('accepts ordinary task ids', () => {
        expect(isValidTaskId('345667896')).toBe(true);
        expect(isValidTaskId('1')).toBe(true);
    });

    it('rejects non-numeric ids that would otherwise raise a bigint error in Postgres', () => {
        expect(isValidTaskId('abc')).toBe(false);
        expect(isValidTaskId('12a')).toBe(false);
        expect(isValidTaskId('')).toBe(false);
        expect(isValidTaskId('1.5')).toBe(false);
        expect(isValidTaskId('-1')).toBe(false);
        expect(isValidTaskId(' 12')).toBe(false);
    });

    it('rejects values beyond BIGINT range instead of letting them 500', () => {
        expect(isValidTaskId('9'.repeat(300))).toBe(false);
        expect(isValidTaskId('9223372036854775808')).toBe(false); // BIGINT max + 1
        expect(isValidTaskId('9223372036854775807')).toBe(true); // BIGINT max
    });
});
