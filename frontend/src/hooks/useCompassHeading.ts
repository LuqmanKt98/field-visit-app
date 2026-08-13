import { useCallback, useEffect, useState } from 'react';
import { headingToCardinal } from '../utils/geo';

// iOS Safari exposes compass heading via a non-standard field and requires an
// explicit user-gesture permission prompt; other browsers expose it via the
// standard 'absolute' deviceorientation event. There's no way to unit-test
// compass accuracy without a physical device -- treat headings as best-effort.
interface IOSDeviceOrientationEvent extends DeviceOrientationEvent {
    webkitCompassHeading?: number;
}

type OrientationPermissionEvent = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
};

export interface CompassState {
    headingDegrees: number | null;
    cardinal: string | null;
    needsPermissionRequest: boolean;
    permissionDenied: boolean;
}

function readHeading(event: IOSDeviceOrientationEvent): number | null {
    if (typeof event.webkitCompassHeading === 'number') {
        return event.webkitCompassHeading;
    }
    if (event.alpha !== null && event.absolute) {
        return (360 - event.alpha) % 360;
    }
    return null;
}

export function useCompassHeading(): CompassState & { requestPermission: () => Promise<void> } {
    const [heading, setHeading] = useState<number | null>(null);
    const [needsPermissionRequest, setNeedsPermissionRequest] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);

    const attachListener = useCallback(() => {
        const handler = (event: Event) => {
            const value = readHeading(event as IOSDeviceOrientationEvent);
            if (value !== null) setHeading(value);
        };
        window.addEventListener('deviceorientationabsolute', handler);
        window.addEventListener('deviceorientation', handler);
        return () => {
            window.removeEventListener('deviceorientationabsolute', handler);
            window.removeEventListener('deviceorientation', handler);
        };
    }, []);

    useEffect(() => {
        const OrientationEventCtor = window.DeviceOrientationEvent as OrientationPermissionEvent | undefined;
        if (OrientationEventCtor?.requestPermission) {
            setNeedsPermissionRequest(true);
            return;
        }
        return attachListener();
    }, [attachListener]);

    const requestPermission = useCallback(async () => {
        const OrientationEventCtor = window.DeviceOrientationEvent as OrientationPermissionEvent | undefined;
        if (!OrientationEventCtor?.requestPermission) return;
        try {
            const result = await OrientationEventCtor.requestPermission();
            if (result === 'granted') {
                setNeedsPermissionRequest(false);
                attachListener();
            } else {
                setPermissionDenied(true);
            }
        } catch {
            setPermissionDenied(true);
        }
    }, [attachListener]);

    return {
        headingDegrees: heading,
        cardinal: heading !== null ? headingToCardinal(heading) : null,
        needsPermissionRequest,
        permissionDenied,
        requestPermission,
    };
}
