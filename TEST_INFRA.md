# LizardTalk Web — E2E Test Infrastructure & Methodology Specification

## 1. Overview & Architecture

The LizardTalk Web E2E Test Suite provides an independent, completely opaque-box verification system for the entire application stack. In accordance with zero-trust testing principles, tests interact strictly through externally accessible network entry points:
1. **WebSocket Relay**: `ws://localhost:8081/mtproxy?dcId=${signedDcId}` (and `?raw=1`)
2. **REST Management API**: `http://localhost:8081/api/*` (`/api/proxies`, `/api/proxies/active`, `/api/health`)
3. **Frontend Application**: `http://localhost:8080` (LizardTalk Web A / Teact)
4. **Programmatic Verification CLI**: `npm run verify:mtproxy`
5. **System Launcher**: `start.ps1` and `.env` configuration

```
┌────────────────────────────────────────────────────────────────────────┐
│                        E2E Test Runner Harness                         │
│                    `npx tsx tests/e2e/runner.ts`                       │
└────────────────────────────────────────────────────────────────────────┘
          │                   │                     │
          ▼                   ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   Tier 1 Tests   │ │   Tier 2 Tests   │ │   Tier 3 & 4     │
│ Feature Coverage │ │ Boundary & Edge  │ │ Cross-Feature &  │
│ (>=5 tests / feat│ │ Cases & Stress   │ │ Real-World E2E   │
└──────────────────┘ └──────────────────┘ └──────────────────┘
          │                   │                     │
          └───────────────────┼─────────────────────┘
                              ▼
    ┌──────────────────────────────────────────────────┐
    │              Opaque-Box Test Entry Points        │
    │  - WebSocket: ws://localhost:8081/mtproxy        │
    │  - REST API:  http://localhost:8081/api/*        │
    │  - Frontend:  http://localhost:8080/             │
    │  - CLI:       npm run verify:mtproxy             │
    └──────────────────────────────────────────────────┘
```

The test harness uses native Node.js 22 built-ins (`globalThis.WebSocket`, `globalThis.fetch`, `node:crypto`, `node:net`), requiring zero third-party testing dependencies, ensuring 100% deterministic portability on Windows, Linux, and macOS.

---

## 2. Runner Invocation & CLI Options

The test suite is executed using `tsx`:

```powershell
# Run the entire E2E test suite (Tiers 1–4)
npx tsx tests/e2e/runner.ts

# Or via npm script (when defined in package.json)
npm run test:e2e

# Run only a specific tier
npx tsx tests/e2e/runner.ts --tier 1
npx tsx tests/e2e/runner.ts --tier 2
npx tsx tests/e2e/runner.ts --tier 3
npx tsx tests/e2e/runner.ts --tier 4

# Run tests matching a specific query
npx tsx tests/e2e/runner.ts --grep "Obfuscated2"
npx tsx tests/e2e/runner.ts --grep "REST API"

# Verbose output with full packet dumps
npx tsx tests/e2e/runner.ts --verbose
```

### Exit Codes:
- `0`: All tests passed successfully.
- `1`: One or more tests failed, or prerequisite services are unreachable.

---

## 3. The 4-Tier Test Methodology

The test suite is structured into four distinct verification tiers:

### Tier 1: Feature Coverage (>=5 Tests per Primary Feature)
Every architectural requirement must have at least 5 rigorous, distinct test cases covering its core specification:

1. **Backend Service & Health API (`tier1-backend-health.ts`)**:
   - `T1.1.1`: `GET /api/health` returns status `ok` and valid `activeProxy` object.
   - `T1.1.2`: `GET /api/proxies` returns list containing default primary proxy (`54.255.212.228:443`).
   - `T1.1.3`: Server listens on configured port (8081) with valid CORS headers.
   - `T1.1.4`: Health check timestamps are formatted as valid ISO 8601 strings (`lastChecked`).
   - `T1.1.5`: Non-existent endpoints return standard HTTP 404 with JSON error payload.

2. **Binary WebSocket Relay (`tier1-ws-relay.ts`)**:
   - `T1.2.1`: WebSocket handshake to `ws://localhost:8081/mtproxy?dcId=2` succeeds with HTTP 101 Switching Protocols.
   - `T1.2.2`: WebSocket connection requires binary frames (`arraybuffer`) and rejects invalid payloads.
   - `T1.2.3`: Bridge properly handles Abridged transport framing (`0xef` header).
   - `T1.2.4`: Bridge successfully tunnels MTProto `req_pq_multi` frame and receives `resPQ`.
   - `T1.2.5`: Raw pass-through mode (`?raw=1`) streams unencrypted TCP byte streams without applying bridge Obfuscated2 handshake.

3. **Multi-DC & Media Routing (`tier1-dc-routing.ts`)**:
   - `T1.3.1`: Routes to DC 1 (Miami, signed dcId `1`).
   - `T1.3.2`: Routes to DC 2 (Amsterdam, signed dcId `2`).
   - `T1.3.3`: Routes to DC 3 (Miami, signed dcId `3`).
   - `T1.3.4`: Routes to DC 4 (Amsterdam, signed dcId `4`).
   - `T1.3.5`: Routes to DC 5 (Singapore, signed dcId `5`).
   - `T1.3.6`: Routes to Media DCs -1 through -5 (signed negative 16-bit dcIds).

4. **MTProxy Cryptographic Handshake (`tier1-crypto-handshake.ts`)**:
   - `T1.4.1`: 64-byte Obfuscated2 header derivation with SHA256(encryptKey + secret).
   - `T1.4.2`: Protocol tag `0xeeeeeeee` (Intermediate) handshake validation.
   - `T1.4.3`: Padded intermediate `0xdddddddd` secrets support with random padding.
   - `T1.4.4`: Fake-TLS `ee`-prefixed secrets parsing and SNI domain extraction.
   - `T1.4.5`: AES-256-CTR keystream state alignment after 64-byte header consumption.

5. **Proxy Pool Management & Failover (`tier1-proxy-pool.ts`)**:
   - `T1.5.1`: `POST /api/proxies` adds a new proxy candidate with immediate health check.
   - `T1.5.2`: `POST /api/proxies/active` switches the active proxy and persists state.
   - `T1.5.3`: `DELETE /api/proxies/:id` deletes a non-default proxy record.
   - `T1.5.4`: `DELETE /api/proxies/:id` on default proxy is strictly rejected with HTTP 403 Forbidden.
   - `T1.5.5`: Auto-failover promotes next healthy proxy when active proxy fails.

6. **Programmatic Verification CLI (`tier1-verify-script.ts`)**:
   - `T1.6.1`: `npm run verify:mtproxy` script exists and executes.
   - `T1.6.2`: Verifies Pollard's rho PQ factorization algorithm on 64-bit integers.
   - `T1.6.3`: Completes `req_pq_multi` -> `resPQ#05162463`.
   - `T1.6.4`: Completes `req_DH_params` with Telegram RSA public key.
   - `T1.6.5`: Completes `set_client_DH_params` and validates encrypted session creation.

7. **Frontend Web App & Branding (`tier1-frontend-branding.ts`)**:
   - `T1.7.1`: HTTP server at `http://localhost:8080` returns 200 OK with `index.html`.
   - `T1.7.2`: Document `<title>` reflects "LizardTalk" branding.
   - `T1.7.3`: Content Security Policy (`connect-src`) permits `ws://localhost:8081` and `http://localhost:8081`.
   - `T1.7.4`: Telegram Web A bundle assets load with zero 404 errors.
   - `T1.7.5`: Verification of zero hardcoded `web.telegram.org` direct WebSocket references in network config.

8. **Workspace UI & Formatting Compliance (`tier1-workspace-compliance.ts`)**:
   - `T1.8.1`: Proxy latency timestamps adhere to GMT+8 (`Asia/Kuala_Lumpur`) format.
   - `T1.8.2`: Table timestamp formatting strictly enforces two-row stacked format (`DD-MM-YY` top, `HH:mm:ss` bottom).
   - `T1.8.3`: Mandatory delete confirmation prompt requirement.
   - `T1.8.4`: Zero manual refresh buttons present in proxy manager UI.
   - `T1.8.5`: Visible error banner / alert states rendered on proxy failure.

9. **Root Environment & PowerShell Scripts (`tier1-root-scripts.ts`)**:
   - `T1.9.1`: Root `.env` file exists and contains all required variables (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, etc.).
   - `T1.9.2`: `start.ps1` PowerShell script is syntactically valid and executable.
   - `T1.9.3`: Pre-flight TCP connectivity probe succeeds to `54.255.212.228:443`.
   - `T1.9.4`: Concurrent startup configuration in root `package.json` (`concurrently`).
   - `T1.9.5`: Verification that no unapproved git operations or stage files exist.

---

### Tier 2: Boundary & Corner Cases (`tier2-boundary/`)
Tests boundary limits, malformed payloads, abrupt terminations, and error propagation:
- `T2.1`: **Invalid DC IDs**: Tests connection with `dcId=0`, `dcId=6`, `dcId=-6`, `dcId=99999`, and non-numeric `dcId=abc` -> returns immediate WebSocket close with error code 1008/1002.
- `T2.2`: **Malformed Proxy Secrets**: Attempts to add proxies with non-hex secrets, truncated secrets (<16 bytes), overlong secrets (>17 bytes non-TLS), and corrupt Fake-TLS headers.
- `T2.3`: **Early Client Disconnect**: Client connects to `/mtproxy` and immediately closes before handshake completes -> verifies backend releases TCP socket cleanly without leaking file descriptors.
- `T2.4`: **Abrupt Proxy Reset**: Remote proxy TCP connection drops mid-stream -> bridge propagates close to WebSocket client with clean error state.
- `T2.5`: **Packet Fragmentation**: Transmits MTProto frames split across 1-byte chunks -> bridge reassembles frames correctly.
- `T2.6`: **Extreme Payloads**: Transmits oversized frame exceeding MTProto max packet size (>16MB) -> bridge rejects and closes.
- `T2.7`: **Default Proxy Immutability**: `DELETE /api/proxies/<default-id>` strictly returns 403 Forbidden with `{ error: "Cannot delete default proxy" }`.
- `T2.8`: **Switch to Non-Existent Proxy**: `POST /api/proxies/active` with invalid ID returns 404 Not Found.
- `T2.9`: **Simultaneous Duplicate Connections**: 20 concurrent WebSocket connections to the same DC ID simultaneously.
- `T2.10`: **Strict Fallback Reduction**: Missing fields in REST API payloads fail loudly with 400 Bad Request instead of substituting silent defaults.

---

### Tier 3: Cross-Feature Combinations (`tier3-combination/`)
Tests interaction and state synchronization across multiple features simultaneously:
- `T3.1`: **Active Proxy Switching During Live Stream**: Switch active proxy while a DC connection is active -> verifies existing connection lifecycle and subsequent connections route to new proxy.
- `T3.2`: **Simultaneous Media DC & Chat DC**: Concurrently stream media from DC -2 while exchanging MTProto chat messages on DC 2 -> verifies bridge multiplexing.
- `T3.3`: **Auto-Failover Under Load**: Simulate active proxy failure during continuous traffic -> verifies failover promotes secondary and WebSocket reconnects.
- `T3.4`: **Add Proxy & Route Immediate Session**: Add a new proxy via REST API and immediately initiate a WebSocket connection specifying that proxy.
- `T3.5`: **Multi-DC Parallel Session Multiplexing**: 5 parallel WebSocket connections to DC 1, 2, 3, 4, 5 operating concurrently through the bridge.
- `T3.6`: **REST Health Polling Concurrent with Heavy MTProto Transfer**: Run 10 requests/sec against `/api/proxies` while saturating WebSocket throughput.

---

### Tier 4: Real-World Scenarios (`tier4-scenarios/`)
End-to-end simulations of actual user workflows:
- `T4.1`: **Complete MTProto 2.0 Auth Sequence**:
  - Connects to `ws://localhost:8081/mtproxy?dcId=2`.
  - Executes `req_pq_multi` -> receives `resPQ#05162463`.
  - Factors PQ using Pollard's rho -> finds `p` and `q`.
  - Executes `req_DH_params` with encrypted inner data.
  - Completes `set_client_DH_params` and validates `dh_gen_ok`.
- `T4.2`: **Telegram Web A QR Code Login Emulation**:
  - Emulates GramJS auth workflow: sends `auth.exportLoginToken` MTProto RPC over bridge.
  - Validates response format and QR token generation.
- `T4.3`: **Multi-DC Production Roundtrip**:
  - Pings DC 1, DC 2, DC 3, DC 4, DC 5, and DC -2 consecutively over bridge.
  - Measures latency and verifies responses across all DCs.
- `T4.4`: **Complete Proxy Management Lifecycle**:
  - Add backup proxy via `POST /api/proxies`.
  - Query `GET /api/proxies` to verify inclusion and ISO 8601 timestamp.
  - Activate proxy via `POST /api/proxies/active`.
  - Attempt to delete default proxy (verifies 403 rejection).
  - Switch back to default proxy.
  - Delete added proxy via `DELETE /api/proxies/:id`.
  - Verify removal from pool.
- `T4.5`: **Frontend Application & Security Audit**:
  - Fetch `http://localhost:8080/`.
  - Verify HTML structure, viewport, meta tags, and title branding ("LizardTalk").
  - Audit CSP headers ensuring `ws://localhost:8081` is permitted and direct `web.telegram.org` connections are disabled.

---

## 4. Test Harness Directory Layout

```
tests/e2e/
├── runner.ts                     # Main test suite runner & CLI
├── harness/
│   ├── config.ts                 # Ports, hosts, credentials, URLs
│   ├── ws-client.ts              # WebSocket MTProto test client
│   ├── api-client.ts             # REST API client
│   ├── mtproto-codec.ts          # MTProto & Obfuscated2 binary codecs
│   └── test-utils.ts             # Assertions, timers, color logging
├── tier1-feature/
│   ├── tier1-backend-health.ts   # Feature 6, 8, 9 (Health & REST)
│   ├── tier1-ws-relay.ts         # Feature 5, 7 (WebSocket Relay)
│   ├── tier1-dc-routing.ts       # Feature 4 (DC 1-5, Media -1..-5)
│   ├── tier1-crypto-handshake.ts # Feature 5 (Obfuscated2, dd, ee)
│   ├── tier1-proxy-pool.ts       # Feature 8, 9, 13 (Pool & Failover)
│   ├── tier1-verify-script.ts    # Feature 17 (verify:mtproxy DH)
│   ├── tier1-frontend-branding.ts# Feature 1, 3, 10 (Frontend & CSP)
│   ├── tier1-workspace-compliance.ts # Feature 14, 18 (UI & Git rules)
│   └── tier1-root-scripts.ts     # Feature 2, 15, 16 (start.ps1, .env)
├── tier2-boundary/
│   ├── tier2-invalid-dc.ts       # Invalid & boundary DC IDs
│   ├── tier2-malformed-secrets.ts# Bad & corrupt proxy secrets
│   ├── tier2-disconnects.ts      # Abrupt drops & socket cleanup
│   └── tier2-api-boundaries.ts   # 403 default delete, 404, bad JSON
├── tier3-combination/
│   ├── tier3-proxy-switching.ts  # Switching proxy during active stream
│   ├── tier3-concurrent-dcs.ts   # Media DC -2 + Chat DC 2 parallel
│   └── tier3-stress-multiplex.ts # Heavy load + health polling
└── tier4-scenarios/
    ├── tier4-dh-handshake.ts     # Complete MTProto 2.0 DH key exchange
    ├── tier4-login-token.ts      # Telegram QR / Login token simulation
    ├── tier4-multi-dc-tour.ts    # Multi-DC roundtrips DC 1..5 & -1..-5
    ├── tier4-proxy-lifecycle.ts  # Full CRUD lifecycle & immutability
    └── tier4-frontend-audit.ts   # Live DOM, CSP, and branding check
```
