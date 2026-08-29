import { useCallback, useEffect, useRef, useState } from 'react';
import { headingToCardinal } from '@/utils/geo';

// iOS Safari exposes a true-north heading on a non-standard field and requires an
// explicit, user-gesture permission prompt. Android exposes it either through the
// 'deviceorientationabsolute' event or through AbsoluteOrientationSensor.
interface IOSDeviceOrientationEvent extends DeviceOrientationEvent {
    webkitCompassHeading?: number;
}

type OrientationPermissionEvent = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
};

interface OrientationSensorLike {
    quaternion: number[] | null;
    start(): void;
    stop(): void;
    addEventListener(type: string, listener: () => void): void;
}

type AbsoluteOrientationSensorCtor = new (options?: {
    frequency?: number;
    referenceFrame?: 'device' | 'screen';
}) => OrientationSensorLike;

/** Which sensor produced the current reading -- surfaced so it can be verified on a device. */
export type CompassSource = 'ios' | 'deviceorientationabsolute' | 'orientation-sensor' | null;

export interface CompassState {
    headingDegrees: number | null;
    cardinal: string | null;
    source: CompassSource;
    needsPermissionRequest: boolean;
    permissionDenied: boolean;
    /** True once we have waited long enough to conclude no compass is coming. */
    unavailable: boolean;
}

function readEventHeading(event: IOSDeviceOrientationEvent): number | null {
    // iOS: already a true-north compass bearing.
    if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
        return event.webkitCompassHeading;
    }
    // Only an absolute reading is a real bearing. A relative one (absolute === false)
    // is measured from wherever the device happened to start, so treating it as a
    // compass direction would stamp confident-looking but wrong data onto evidence
    // photos -- worse than recording nothing.
    if (event.alpha !== null && event.absolute) {
        return (360 - event.alpha) % 360;
    }
    return null;
}

/** Compass bearing from an absolute-orientation quaternion [x, y, z, w]. */
function headingFromQuaternion(q: number[]): number | null {
    if (!q || q.length < 4) return null;
    const [x, y, z, w] = q;
    const yaw = Math.atan2(2 * (x * y + w * z), w * w + x * x - y * y - z * z);
    const deg = (yaw * 180) / Math.PI;
    return (360 - ((deg + 360) % 360)) % 360;
}

export function useCompassHeading(): CompassState & { requestPermission: () => Promise<void> } {
    const [heading, setHeading] = useState<number | null>(null);
    const [source, setSource] = useState<CompassSource>(null);
    const [needsPermissionRequest, setNeedsPermissionRequest] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    // Flipped once iOS grants permission, which re-runs the attach effect below.
    const [listening, setListening] = useState(false);
    const gotReadingRef = useRef(false);

    useEffect(() => {
        const OrientationEventCtor = window.DeviceOrientationEvent as OrientationPermissionEvent | undefined;
        // iOS needs an explicit, user-gesture-triggered request before anything fires.
        if (OrientationEventCtor?.requestPermission && !listening) {
            setNeedsPermissionRequest(true);
            return;
        }

        const accept = (value: number, from: CompassSource) => {
            gotReadingRef.current = true;
            setHeading(value);
            setSource(from);
            setUnavailable(false);
        };

        const handler = (event: Event) => {
            const value = readEventHeading(event as IOSDeviceOrientationEvent);
            if (value === null) return;
            const isIOS = typeof (event as IOSDeviceOrientationEvent).webkitCompassHeading === 'number';
            accept(value, isIOS ? 'ios' : 'deviceorientationabsolute');
        };
        window.addEventListener('deviceorientationabsolute', handler);
        window.addEventListener('deviceorientation', handler);

        // Android fallback. Plenty of Android browsers never fire
        // 'deviceorientationabsolute' and only send relative 'deviceorientation'
        // readings, which are useless as a bearing -- those devices produced a
        // "Direction: N/A" stamp on every photo. AbsoluteOrientationSensor reads the
        // magnetometer directly and is the supported path there.
        let sensor: OrientationSensorLike | null = null;
        const SensorCtor = (window as unknown as { AbsoluteOrientationSensor?: AbsoluteOrientationSensorCtor })
            .AbsoluteOrientationSensor;
        if (SensorCtor) {
            try {
                sensor = new SensorCtor({ frequency: 10, referenceFrame: 'device' });
                sensor.addEventListener('reading', () => {
                    const value = sensor?.quaternion ? headingFromQuaternion(sensor.quaternion) : null;
                    // Never let the fallback override a true-north event source.
                    if (value !== null && (source === null || source === 'orientation-sensor')) {
                        accept(value, 'orientation-sensor');
                    }
                });
                sensor.addEventListener('error', () => undefined);
                sensor.start();
            } catch {
                sensor = null;
            }
        }

        // Conclude "no compass" only after giving every source a chance to report.
        const verdict = setTimeout(() => {
            if (!gotReadingRef.current) setUnavailable(true);
        }, 4000);

        return () => {
            clearTimeout(verdict);
            window.removeEventListener('deviceorientationabsolute', handler);
            window.removeEventListener('deviceorientation', handler);
            try {
                sensor?.stop();
            } catch {
                // Sensor may already be stopped by the platform.
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listening]);

    const requestPermission = useCallback(async () => {
        const OrientationEventCtor = window.DeviceOrientationEvent as OrientationPermissionEvent | undefined;
        if (!OrientationEventCtor?.requestPermission) return;
        try {
            const result = await OrientationEventCtor.requestPermission();
            if (result === 'granted') {
                setNeedsPermissionRequest(false);
                setListening(true);
            } else {
                setPermissionDenied(true);
            }
        } catch {
            setPermissionDenied(true);
        }
    }, []);

    return {
        headingDegrees: heading,
        cardinal: heading !== null ? headingToCardinal(heading) : null,
        source,
        needsPermissionRequest,
        permissionDenied,
        unavailable,
        requestPermission,
    };
}
