export interface ParsedLocation {
    latitude: number;
    longitude: number;
    /** Which part of the input the position came from, for the confirmation message. */
    from: 'place-pin' | 'route-end' | 'coordinates' | 'map-centre';
}

/**
 * Nothing real is longer than this, and everything past it is a cost with no benefit.
 * A crafted string of tens of thousands of characters made the patterns below run for
 * seconds on the main thread, freezing the tab of whoever pasted it.
 */
const MAX_INPUT = 2048;

// Google, phone keyboards and survey documents all disagree about which glyph is a
// degree, a minute and a second. Accepting one spelling of each was the difference
// between "it works" and "it silently found nothing".
const DEG = '[\\u00B0\\u00BA\\u02DA\\u2218]';
const MIN = "['\\u2019\\u2032]";
// Folded into one character class rather than \s*"?\s*: two adjacent optional-space
// groups let the engine try every way of splitting a run of spaces, which is quadratic
// and was measurably so -- 7.5 s on a 100 KB paste.
const SEC_TRAIL = '[\\s"\\u201D\\u2033]*';

const DMS_PATTERN = new RegExp(
    `(\\d{1,3})\\s*${DEG}\\s*(\\d{1,2})\\s*${MIN}\\s*(\\d{1,2}(?:\\.\\d+)?)${SEC_TRAIL}([NS])[\\s,+]+` +
        `(\\d{1,3})\\s*${DEG}\\s*(\\d{1,2})\\s*${MIN}\\s*(\\d{1,2}(?:\\.\\d+)?)${SEC_TRAIL}([EW])`,
    'i',
);

/** Rejects the impossible early, so a mistyped number never becomes a pin in the sea. */
function valid(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180 &&
        // Null Island is where a pair of zeroes lands, and it is never a real property.
        !(lat === 0 && lng === 0)
    );
}

/** Degrees/minutes/seconds -> decimal degrees. */
function fromDms(deg: string, min: string, sec: string, hemisphere: string): number {
    const value = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
    return /[SW]/i.test(hemisphere) ? -value : value;
}

/**
 * Pulls a position out of whatever the office pastes in.
 *
 * Vacant land has no address to search for, so a Google Maps link is the only thing the
 * person has -- they drop a pin on the plot, share it, and paste it here. Typed
 * coordinates are accepted too, in both the decimal and the degrees-minutes-seconds
 * forms Google shows.
 *
 * Order matters. A Maps place URL carries the position up to three times and they are
 * not the same point: `!3d`/`!4d` is a dropped pin, while `@lat,lng,zoom` is only where
 * the map was scrolled to when the link was made. In the link this was built against
 * those two sit about 40 m apart -- a meaningful slice of a 100 m geofence, and enough
 * to leave a rep standing at the edge of the plot wondering why the camera will not
 * open. So pins are read first and the viewport is a last resort.
 *
 * Returns null when there is nothing position-like in the text, including for a short
 * maps.app.goo.gl link, whose target is only known after a redirect the browser is not
 * allowed to read.
 */
export function parseLocationInput(raw: string): ParsedLocation | null {
    if (!raw?.trim()) return null;

    // Percent-encoded degree signs and quotes are normal in a copied Maps URL.
    let text = raw.trim().slice(0, MAX_INPUT);
    try {
        text = decodeURIComponent(text);
    } catch {
        // Malformed escapes: keep the original rather than losing the whole input.
    }

    // 1. Dropped pins in a Maps URL.
    //
    // A directions link carries one pair per waypoint, so taking the first match put
    // the pin on the start of the journey while confidently calling it the property.
    // The last pair is the destination, which is the one someone sharing a route means
    // -- but more than one pair also means the link is not simply a place, so the
    // caller is told to check it rather than being reassured.
    const pins = [...text.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
    if (pins.length > 0) {
        const last = pins[pins.length - 1];
        const lat = Number(last[1]);
        const lng = Number(last[2]);
        if (valid(lat, lng)) {
            return { latitude: lat, longitude: lng, from: pins.length > 1 ? 'route-end' : 'place-pin' };
        }
    }

    // 2. Degrees/minutes/seconds, as Maps writes them into the /place/ segment and as a
    //    survey document is most likely to carry them.
    const dms = text.match(DMS_PATTERN);
    if (dms) {
        const lat = fromDms(dms[1], dms[2], dms[3], dms[4]);
        const lng = fromDms(dms[5], dms[6], dms[7], dms[8]);
        if (valid(lat, lng)) return { latitude: lat, longitude: lng, from: 'place-pin' };
    }

    // 3. A decimal pair sitting in the /place/ segment, which is what Maps produces when
    //    the thing searched for was itself a pair of coordinates.
    const placePair = text.match(/\/place\/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (placePair) {
        const lat = Number(placePair[1]);
        const lng = Number(placePair[2]);
        if (valid(lat, lng)) return { latitude: lat, longitude: lng, from: 'place-pin' };
    }

    // 4. Explicit query parameters, which are what the Maps sharing API produces.
    const query = text.match(/[?&](?:q|ll|query|destination|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (query) {
        const lat = Number(query[1]);
        const lng = Number(query[2]);
        if (valid(lat, lng)) return { latitude: lat, longitude: lng, from: 'coordinates' };
    }

    // 5. A bare pair the user typed or copied out of a spreadsheet. Anchored to the
    //    whole input, so a pair buried in a URL cannot outrank the checks above.
    const pair = text.match(/^\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[, ]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
    if (pair) {
        const lat = Number(pair[1]);
        const lng = Number(pair[2]);
        if (valid(lat, lng)) return { latitude: lat, longitude: lng, from: 'coordinates' };
    }

    // 6. Where the map happened to be pointing. Last, and labelled differently, because
    //    it is the least likely to be the plot itself.
    const centre = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (centre) {
        const lat = Number(centre[1]);
        const lng = Number(centre[2]);
        if (valid(lat, lng)) return { latitude: lat, longitude: lng, from: 'map-centre' };
    }

    return null;
}

/**
 * True for the shortened links the Maps app produces from its Share button, whose
 * destination only exists behind a redirect. The browser cannot read that redirect, so
 * these have to be handed to the server to expand.
 */
export function isShortMapLink(raw: string): boolean {
    return /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+\/maps\?[^ ]*\bcid=)/i.test(
        raw.trim().slice(0, MAX_INPUT),
    );
}

/** True for anything that looks like an attempt at a location, for error wording. */
export function looksLikeLocationAttempt(raw: string): boolean {
    const text = raw.trim().slice(0, MAX_INPUT);
    return text.length > 0 && (/https?:\/\//i.test(text) || /\d/.test(text));
}
