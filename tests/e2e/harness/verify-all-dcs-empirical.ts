import { WsMtproxyClient } from './ws-client.js';

interface DcTestResult {
  dc: number;
  type: 'production' | 'media';
  status: 'pass' | 'fail';
  constructorId?: string;
  durationMs: number;
  error?: string;
}

async function run() {
  const dcs = [
    { id: 1, type: 'production' as const },
    { id: 2, type: 'production' as const },
    { id: 3, type: 'production' as const },
    { id: 4, type: 'production' as const },
    { id: 5, type: 'production' as const },
    { id: -1, type: 'media' as const },
    { id: -2, type: 'media' as const },
    { id: -3, type: 'media' as const },
    { id: -4, type: 'media' as const },
    { id: -5, type: 'media' as const },
  ];

  console.log('Testing MTProto handshake across all 5 Production DCs and 5 Media DCs:');
  const results: DcTestResult[] = [];

  for (const item of dcs) {
    const start = Date.now();
    const client = new WsMtproxyClient();
    try {
      await client.connect(item.id, { timeoutMs: 6000 });
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 6000);
      const isOk = resPq.constructorId === 0x05162463;
      results.push({
        dc: item.id,
        type: item.type,
        status: isOk ? 'pass' : 'fail',
        constructorId: '0x' + resPq.constructorId.toString(16),
        durationMs: Date.now() - start,
      });
      console.log(`  DC ${item.id >= 0 ? '+' + item.id : item.id} (${item.type}): PASS (${Date.now() - start}ms) - resPQ constructor 0x${resPq.constructorId.toString(16)}`);
    } catch (err: any) {
      results.push({
        dc: item.id,
        type: item.type,
        status: 'fail',
        durationMs: Date.now() - start,
        error: err.message,
      });
      console.log(`  DC ${item.id >= 0 ? '+' + item.id : item.id} (${item.type}): FAIL (${Date.now() - start}ms) - ${err.message}`);
    } finally {
      client.close();
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
