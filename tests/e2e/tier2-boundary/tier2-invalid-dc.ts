/**
 * Tier 2 Boundary Tests: Invalid & Out-of-Bounds DC IDs
 * Tests rejection of invalid dcIds (0, 6, -6, 99999, non-numeric)
 */

import { registerTest, assert } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier2InvalidDcTests() {
  const invalidDcs = [
    { dcId: 0, label: 'dcId=0 (zero)' },
    { dcId: 6, label: 'dcId=6 (greater than max DC 5)' },
    { dcId: -6, label: 'dcId=-6 (less than min media DC -5)' },
    { dcId: 99999, label: 'dcId=99999 (16-bit integer overflow)' },
  ];

  for (const { dcId, label } of invalidDcs) {
    registerTest(2, 'Boundary: Invalid DC IDs', `T2.1: Reject out-of-bounds ${label}`, async () => {
      const client = new WsMtproxyClient();
      let rejectedOrClosed = false;
      try {
        await client.connect(dcId, { timeoutMs: 3000 });
        // If it connected, sending a message must trigger closure or error
        try {
          await client.sendReqPqAndExpectResPq('abridged', 2000);
        } catch {
          rejectedOrClosed = true;
        }
      } catch {
        rejectedOrClosed = true;
      } finally {
        client.close();
      }
      assert(rejectedOrClosed, `Expected connection with ${label} to be rejected or closed`);
    });
  }

  registerTest(2, 'Boundary: Invalid DC IDs', 'T2.1.5: Reject non-numeric dcId parameter', async () => {
    const client = new WsMtproxyClient();
    let rejectedOrClosed = false;
    try {
      await client.connect('not_a_number' as any, { timeoutMs: 3000 });
      try {
        await client.sendReqPqAndExpectResPq('abridged', 2000);
      } catch {
        rejectedOrClosed = true;
      }
    } catch {
      rejectedOrClosed = true;
    } finally {
      client.close();
    }
    assert(rejectedOrClosed, 'Expected non-numeric dcId to be rejected or closed');
  });
}
