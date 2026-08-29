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

interface SensorErrorEvent extends Event {
    error?: { name?: string; message?: string };
}

interface OrientationSensorLike {
    quaternion: number[] | null;
    start(): void;
    stop(): void;
    addEventListener(type: 'reading', listener: () => void): void;
    addEventListener(type: 'error', listener: (event: SensorErrorEvent) => void): void;
}

type AbsoluteOrientationSensorCtor = new (options?: {
    frequency?: number;
    referenceFrame?: 'device' | 'screen';
}) => OrientationSensorLike;

/** Which sensor produced the current reading -- surfaced so it can be verified on a device. */
export type CompassSource = 'ios' | 'deviceorientationabsolute' | 'orientation-sensor' | null;

/**
 * Why no bearing is coming, when we can tell.
 *
 * `no-compass` is the one worth separating out. Plenty of Samsung handsets -- the A and
 * F budget lines especially -- ship with no geomagnetic sensor at all, and on those the
 * standard advice to wave the phone in a figure-8 is not just useless, it sends a rep
 * standing in a street doing something that cannot possibly work.
 */
export type CompassUnavailableReason = 'no-compass' | 'blocked' | 'no-signal' | null;

export interface CompassState {
    headingDegrees: number | null;
    cardinal: string | null;
    source: CompassSource;
    /** Degrees the rear camera sits below horizontal; 90 is straight at the ground. */
    downwardTiltDegrees: number | null;
    needsPermissionRequest: boolean;
    permissionDenied: boolean;
    /** True once we have waited long enough to conclude no compass is coming. */
    unavailable: boolean;
    unavailableReason: CompassUnavailableReason;
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

/**
 * How far below horizontal the rear camera is aimed, in degrees. 0 is level, 90 is
 * straight down at the rep's feet, negative is above horizontal.
 *
 * Derived from the vertical component of the screen's outward normal, cos(beta) *
 * cos(gamma), because the rear camera points exactly opposite the screen. Using both
 * angles rather than beta alone keeps the answer right when the phone is turned on its
 * side -- beta on its own reads a level landscape shot as though it were pointing at
 * the ground.
 *
 * Unlike the heading, this works from a relative reading too: it comes from gravity,
 * not the magnetometer, so it is available on handsets whose compass never reports.
 */
function readDownwardTilt(event: DeviceOrientationEvent): number | null {
    const { beta, gamma } = event;
    if (beta === null || gamma === null) return null;
    const normalUp = Math.cos((beta * Math.PI) / 180) * Math.cos((gamma * Math.PI) / 180);
    return (Math.asin(Math.max(-1, Math.min(1, normalUp))) * 180) / Math.PI;
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
    const [downwardTilt, setDownwardTilt] = useState<number | null>(null);
    const [needsPermissionRequest, setNeedsPermissionRequest] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [unavailableReason, setUnavailableReason] = useState<CompassUnavailableReason>(null);
    // Flipped once iOS grants permission, which re-runs the attach effect below.
    const [listening, setListening] = useState(false);
    const gotReadingRef = useRef(false);
    // Orientation events arriving with absolute === false mean the accelerometer and
    // gyroscope are working and only the magnetic reference is missing. That is the
    // signature of a handset with no geomagnetic sensor, and it is worth telling apart
    // from silence, which means nothing is being delivered at all.
    const sawRelativeRef = useRef(false);
    const sensorErrorRef = useRef<string | null>(null);
    // Read inside a long-lived sensor callback, so it has to be a ref: the callback is
    // registered once per attach and would otherwise keep testing the value of `source`
    // from that first render (always null), letting the fallback sensor overwrite a
    // true-north reading for the whole visit.
    const sourceRef = useRef<CompassSource>(null);

    useEffect(() => {
        const OrientationEventCtor = window.DeviceOrientationEvent as OrientationPermissionEvent | undefined;
        // iOS needs an explicit, user-gesture-triggered request before anything fires.
        if (OrientationEventCtor?.requestPermission && !listening) {
            setNeedsPermissionRequest(true);
            return;
        }

        const accept = (value: number, from: CompassSource) => {
            gotReadingRef.current = true;
            sourceRef.current = from;
            setHeading(value);
            setSource(from);
            setUnavailable(false);
            setUnavailableReason(null);
        };

        const handler = (event: Event) => {
            // Tilt first, and unconditionally: it is useful even on the handsets whose
            // heading is rejected below, and it is the only signal that tells a rep
            // they are photographing the pavement.
            setDownwardTilt(readDownwardTilt(event as DeviceOrientationEvent));

            const orientation = event as DeviceOrientationEvent;
            if (orientation.alpha !== null && !orientation.absolute) sawRelativeRef.current = true;

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
                    if (value !== null && (sourceRef.current === null || sourceRef.current === 'orientation-sensor')) {
                        accept(value, 'orientation-sensor');
                    }
                });
                // Swallowing this used to cost us the single most useful piece of
                // evidence available. AbsoluteOrientationSensor is a fusion of
                // magnetometer, accelerometer and gyroscope, so when the magnetometer
                // is absent it fails here with NotReadableError -- which is exactly how
                // to tell "this phone has no compass" from "something is blocked".
                sensor.addEventListener('error', (event: SensorErrorEvent) => {
                    sensorErrorRef.current = event.error?.name ?? 'UnknownError';
                });
                sensor.start();
            } catch (err) {
                sensorErrorRef.current = (err as { name?: string })?.name ?? 'UnknownError';
                sensor = null;
            }
        }

        // Conclude "no compass" only after giving every source a chance to report, then
        // say which of the three situations it is rather than offering one generic
        // remedy that only helps in one of them.
        const verdict = setTimeout(() => {
            if (gotReadingRef.current) return;
            setUnavailable(true);
            const sensorError = sensorErrorRef.current;
            if (sensorError === 'NotAllowedError' || sensorError === 'SecurityError') {
                setUnavailableReason('blocked');
            } else if (sensorError !== null || sawRelativeRef.current) {
                // Either the fusion sensor could not connect to a magnetometer, or tilt
                // readings are arriving with no magnetic reference attached. Both mean
                // the hardware cannot give a bearing, however long the rep waits.
                setUnavailableReason('no-compass');
            } else {
                setUnavailableReason('no-signal');
            }
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
        downwardTiltDegrees: downwardTilt,
        cardinal: heading !== null ? headingToCardinal(heading) : null,
        source,
        needsPermissionRequest,
        permissionDenied,
        unavailable,
        unavailableReason,
        requestPermission,
    };
}
