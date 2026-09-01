/**
 * Trimming addresses to fit their columns without cutting words in half.
 *
 * A flat `.slice()` on an address produces "...Nandivaram-Guduvanch" or
 * "...Chengalpattu D" -- the reader cannot tell whether that is the real name of the
 * place or a truncation, and it is the line a representative reads on arrival. Dropping
 * whole comma-separated parts is always legible, so that is what happens first, and the
 * length cut is kept only for a single part with no commas to break on.
 */

/**
 * Cuts to `max` characters without splitting a character in half.
 *
 * JavaScript string indices are UTF-16 code units, so slicing between the two halves of
 * an astral character leaves a lone surrogate. Postgres cannot store one, so the driver
 * substitutes U+FFFD and the stored address ends in a replacement character.
 */
function sliceWholeCharacters(text: string, max: number): string {
    if (text.length <= max) return text;
    const lastUnit = text.charCodeAt(max - 1);
    const end = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? max - 1 : max;
    return text.slice(0, end).trimEnd();
}

/** Trims text back to the leading comma-separated parts that fit within `max`. */
export function shortenToFit(text: string, max: number): string {
    const trimmed = text.trim();
    if (max <= 0) return '';
    if (trimmed.length <= max) return trimmed;

    let out = '';
    for (const part of trimmed.split(',').map((p) => p.trim())) {
        const next = out ? `${out}, ${part}` : part;
        if (next.length > max) break;
        out = next;
    }
    // A single part longer than the column is the only case left to cut by length.
    return out || sliceWholeCharacters(trimmed, max);
}

/**
 * Builds the full address, keeping the town and PIN code whole.
 *
 * They are short, and they are what makes a visit findable, so the property name gives
 * up room to them rather than the other way round -- joining all three and cutting the
 * result at 100 dropped the PIN code entirely and left a dangling comma behind it.
 *
 * Neither is repeated if the name already carries it. A name filled in from the pin
 * usually ends with the locality, so joining the town on again read back to the
 * representative as "139, Vishnu Priya Avenue, Moolakazhani, Moolakazhani, 603202" --
 * on every vacant plot, which is most of them. Matched on whole comma-separated parts,
 * so a town that is merely a substring of a street ("Ram" inside "Rampur Road") is
 * still added.
 */
export function buildFullAddress(
    streetAddress: string,
    city: string | undefined,
    pinCode: string | undefined,
    max: number,
): string {
    const alreadyNamed = new Set(
        streetAddress
            .split(',')
            .map((p) => p.trim().toLowerCase())
            .filter(Boolean),
    );
    const tail = [city, pinCode]
        .map((p) => p?.trim())
        .filter((p): p is string => Boolean(p) && !alreadyNamed.has(p!.toLowerCase()))
        .join(', ');
    const room = tail ? max - tail.length - 2 : max;
    const head = shortenToFit(streetAddress, room);
    return shortenToFit([head, tail].filter(Boolean).join(', '), max);
}
