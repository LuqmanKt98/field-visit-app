// TASK_ID is a Postgres BIGINT. Anything non-numeric, or numerically out of range,
// makes the driver raise ("invalid input syntax for type bigint") and surfaces as a
// 500 -- so route handlers validate here first and return 400 instead.
const BIGINT_MAX = 9223372036854775807n;

export function isValidTaskId(value: string): boolean {
    if (!/^\d{1,19}$/.test(value)) return false;
    return BigInt(value) <= BIGINT_MAX;
}
