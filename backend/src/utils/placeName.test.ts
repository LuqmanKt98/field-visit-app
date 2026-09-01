import { describe, expect, it } from 'vitest';
import { buildFullAddress, shortenToFit } from './placeName';

describe('shortenToFit', () => {
    it('leaves anything already short enough alone', () => {
        expect(shortenToFit('Vacant plot, Survey No. 42', 60)).toBe('Vacant plot, Survey No. 42');
    });

    it('drops whole trailing parts rather than cutting a word', () => {
        // 64 characters, so the country has to go -- but "India" leaves whole rather
        // than the column ending "...Nandivaram-Guduvanch" as a flat cut did.
        expect(
            shortenToFit('139, Vishnu Priya Avenue, Moolakazhani, Tamil Nadu 603202, India', 60),
        ).toBe('139, Vishnu Priya Avenue, Moolakazhani, Tamil Nadu 603202');
    });

    it('falls back to a length cut only when one part is longer than the column', () => {
        expect(shortenToFit('A'.repeat(80), 60)).toBe('A'.repeat(60));
    });

    it('never returns more than the column holds', () => {
        for (const input of [
            'B'.repeat(61),
            'C'.repeat(60),
            ','.repeat(70),
            ', ' + 'D'.repeat(70),
            'E'.repeat(70) + ', ',
            ['X'.repeat(70), 'Y'.repeat(70)].join(', '),
        ]) {
            expect(shortenToFit(input, 60).length).toBeLessThanOrEqual(60);
        }
    });

    it('handles empty, blank and comma-only input', () => {
        expect(shortenToFit('', 60)).toBe('');
        expect(shortenToFit('    ', 60)).toBe('');
        expect(shortenToFit(',,,,', 60)).toBe(',,,,');
    });

    it('does not split a character in half', () => {
        // 'F' x 59 then a house emoji: the cut at 60 lands between its two code units,
        // and a lone surrogate reaches Postgres as a replacement character.
        const out = shortenToFit('F'.repeat(59) + '\u{1F3E0}', 60);
        expect(out).toBe('F'.repeat(59));
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    });

    it('keeps Tamil and Devanagari names on whole parts', () => {
        for (const [input, max] of [
            ['மூலக்கழனி, தமிழ்நாடு 603202, இந்தியா', 30],
            ['रिक्त भूखंड, नंदिवरम-गुडुवांचेरी, तमिलनाडु, भारत', 30],
        ] as [string, number][]) {
            const out = shortenToFit(input, max);
            expect(out.length).toBeLessThanOrEqual(max);
            // Whatever survived is a run of whole comma-separated parts of the original.
            expect(input.startsWith(out)).toBe(true);
            expect(input === out || input[out.length] === ',').toBe(true);
        }
    });
});

describe('buildFullAddress', () => {
    it('joins the three parts when they fit', () => {
        expect(buildFullAddress('Vacant plot, Survey No. 42', 'Moolakazhani', '603202', 100)).toBe(
            'Vacant plot, Survey No. 42, Moolakazhani, 603202',
        );
    });

    it('keeps the town and PIN code whole, shortening the name to make room', () => {
        // Joining all three and cutting at 100 gave "...Chengalpattu D" and lost the PIN.
        const out = buildFullAddress(
            'Vacant land, Survey No. 42/1B, Vishnu Priya Avenue, Phase II',
            'Old Mahabalipuram Road, Chengalpattu District',
            '603202',
            100,
        );
        expect(out).toBe(
            'Vacant land, Survey No. 42/1B, Old Mahabalipuram Road, Chengalpattu District, 603202',
        );
        expect(out.length).toBeLessThanOrEqual(100);
        expect(out).not.toMatch(/,$/);
    });

    it('never exceeds the column for the longest values the API accepts', () => {
        const out = buildFullAddress('N'.repeat(60), 'C'.repeat(55), 'P'.repeat(15), 100);
        expect(out.length).toBeLessThanOrEqual(100);
    });

    it('works with no town or PIN code at all', () => {
        expect(buildFullAddress('Land at 12.835472, 80.066889', undefined, undefined, 100)).toBe(
            'Land at 12.835472, 80.066889',
        );
    });
});
