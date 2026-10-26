/**
 * E2E Test Harness Utilities & Assertions
 */

export interface TestCase {
  name: string;
  tier: number;
  feature?: string;
  fn: () => Promise<void>;
}

export interface TestResult {
  name: string;
  tier: number;
  feature?: string;
  passed: boolean;
  durationMs: number;
  error?: Error;
}

// Colors for terminal formatting
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Global registry of test cases
export const testRegistry: TestCase[] = [];

/**
 * Register a test case
 */
export function registerTest(
  tier: number,
  feature: string,
  name: string,
  fn: () => Promise<void>
) {
  testRegistry.push({
    tier,
    feature,
    name,
    fn,
  });
}

/**
 * Basic assertion
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function safeStringify(val: unknown): string {
  if (typeof val === 'bigint') return val.toString() + 'n';
  return JSON.stringify(val, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
}

/**
 * Equality assertion
 */
export function assertEquals<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    const detail = `Expected: ${safeStringify(expected)}, Actual: ${safeStringify(actual)}`;
    throw new Error(message ? `${message} (${detail})` : `Assertion failed: ${detail}`);
  }
}

/**
 * Deep equality assertion
 */
export function assertDeepEquals<T>(actual: T, expected: T, message?: string) {
  const actStr = safeStringify(actual);
  const expStr = safeStringify(expected);
  if (actStr !== expStr) {
    const detail = `Expected: ${expStr}\nReceived: ${actStr}`;
    throw new Error(message ? `${message} (${detail})` : `Assertion failed: ${detail}`);
  }
}

/**
 * Regex match assertion
 */
export function assertMatch(actual: string, pattern: RegExp, message?: string) {
  if (!pattern.test(actual)) {
    throw new Error(
      message
        ? `${message} (String "${actual}" does not match pattern ${pattern})`
        : `Assertion failed: "${actual}" does not match pattern ${pattern}`
    );
  }
}

/**
 * Numerical assertions
 */
export function assertGreaterThan(actual: number, threshold: number, message?: string) {
  if (actual <= threshold) {
    throw new Error(
      message
        ? `${message} (${actual} is not greater than ${threshold})`
        : `Assertion failed: ${actual} is not greater than ${threshold}`
    );
  }
}

export function assertLessThan(actual: number, threshold: number, message?: string) {
  if (actual >= threshold) {
    throw new Error(
      message
        ? `${message} (${actual} is not less than ${threshold})`
        : `Assertion failed: ${actual} is not less than ${threshold}`
    );
  }
}

/**
 * Async rejection assertion
 */
export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedErrorMsgOrRegex?: string | RegExp,
  message?: string
): Promise<Error> {
  let threw = false;
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (err) {
    threw = true;
    errorCaught = err;
  }

  if (!threw) {
    throw new Error(
      message
        ? `${message} (Expected function to reject, but it resolved)`
        : 'Expected function to reject, but it resolved successfully.'
    );
  }

  const errObj = errorCaught instanceof Error ? errorCaught : new Error(String(errorCaught));

  if (expectedErrorMsgOrRegex) {
    if (typeof expectedErrorMsgOrRegex === 'string') {
      if (!errObj.message.includes(expectedErrorMsgOrRegex)) {
        throw new Error(
          `Expected error message to include "${expectedErrorMsgOrRegex}", but got "${errObj.message}"`
        );
      }
    } else if (expectedErrorMsgOrRegex instanceof RegExp) {
      if (!expectedErrorMsgOrRegex.test(errObj.message)) {
        throw new Error(
          `Expected error message to match ${expectedErrorMsgOrRegex}, but got "${errObj.message}"`
        );
      }
    }
  }

  return errObj;
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
