# Project: LizardTalk Web

## Architecture
LizardTalk Web is a full-featured Telegram Web client designed to bypass the GFW in China by tunneling 100% of Telegram MTProto WebSocket traffic across all Telegram Data Centers (DC1–DC5 and media DCs -1..-5) through a companion TypeScript/Node.js WebSocket-to-MTProxy bridge.

```
[Browser Frontend (Telegram Web A / Teact)] :8080
       │
       │  (MTProto Abridged frames over WebSocket)
       ▼
[Local Backend Bridge (Node.js/TypeScript /mtproxy)] :8081
       │
       │  (MTProxy Obfuscated2 Handshake + AES-256-CTR)
       ▼
[Active MTProto Proxy] 54.255.212.228:443
       │
       ▼
[Telegram Production Infrastructure (DC1–DC5 & Media DCs -1..-5)]
```

### Key Architectural Decisions:
1. **Dual-Mode Bridge Architecture**:
   - Browser client connects to `ws://localhost:8081/mtproxy?dcId=${signedDcId}`. The backend bridge manages MTProxy Obfuscated2 handshaking, AES-256-CTR encryption/decryption, secret handling, and automatic failover transparently.
   - Programmatic verification scripts and raw testers can pass `?raw=1` for direct transparent TCP streaming.
2. **DC Routing Support**:
   - DC IDs 1..5 map to signed positive integers `1..5`.
   - Media DCs map to signed negative integers `-1..-5` (16-bit signed LE at bytes 60..61 of Obfuscated2 header).
3. **Secret Types Supported**:
   - Standard 16-byte hex secrets.
   - `dd`-prefixed padded intermediate secrets (`0xdddddddd`).
   - `ee`-prefixed Fake-TLS secrets (SNI domain extraction & TLS emulation).
4. **Proxy Pool & Auto-Failover**:
   - Primary: `54.255.212.228:443`, secret `6c465965316ffd1afb2f0e2b3ea90a86` (verified online, ~16ms).
   - Seed backups: 4 proxies from `grapefruittalk/proxies.json` (handled gracefully when offline).
   - REST API: `GET /api/proxies`, `POST /api/proxies`, `POST /api/proxies/active`, `DELETE /api/proxies/:id`.
5. **UI & Workspace Compliance**:
   - LizardTalk branding on title and auth screens.
   - Global MTProxy Status Badge & Manager Modal mounted in `src/components/App.tsx`.
   - No manual refresh buttons (auto-poll every 5s).
   - Visible error banners.
   - Mandatory deletion confirmation dialog.
   - Two-row stacked table timestamps in GMT+8 (`DD-MM-YY` on top, `HH:mm:ss` smaller & greyed on bottom).
   - Strict fallback reduction (fail loudly).
   - Zero unapproved git operations.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Telegram Web A Codebase Setup | Clone/setup official `Ajaxy/telegram-tt` in `lizardtalk-web` | M2 | R1 |
| 2 | Environment Configuration | Pre-configure `.env` with API ID, Hash, and proxy credentials | M2 | R1 |
| 3 | GramJS WebSocket Redirection | Redirect `PromisedWebSockets.getWebSocketLink` to bridge `/mtproxy?dcId=...` | M2 | R1 |
| 4 | Multi-DC & Media Routing | Route all 5 DCs (1..5) and media DCs (-1..-5) via signed DC ID parameter | M2 | R1 |
| 5 | MTProxy Cryptographic Handshake | Obfuscated2 64-byte header, SHA256 key derivation, AES-256-CTR, standard/dd/ee secrets | M1 | R1, R2 |
| 6 | TypeScript Backend Service | Node.js/TypeScript service running on port 8081 | M1 | R2 |
| 7 | Binary WebSocket-to-TCP Relay | High-performance binary relay at `/mtproxy` | M1 | R2 |
| 8 | Health Checker & Auto-Failover | Real-time TCP + MTProto Obfuscated2 health/latency checks with auto-failover | M1 | R2 |
| 9 | Proxy Management REST API | `GET/POST /api/proxies`, `POST /api/proxies/active`, `DELETE /api/proxies/:id`, ISO 8601 storage | M1 | R2 |
| 10 | LizardTalk Branding | Page title, login screen title, header branding | M3 | R3 |
| 11 | Floating Status Badge & Modal | Sleek badge and manager modal accessible on Login and Chat screens | M3 | R3 |
| 12 | Live Measured Latency | Measured latency in ms displayed with color-coded connection status | M3 | R3 |
| 13 | Proxy Switching, Add & Delete | Switch active proxy, add new proxies, delete non-default proxies | M3 | R3 |
| 14 | Workspace UI Compliance | No refresh buttons, visible errors, delete confirmation, GMT+8 stacked timestamps | M3 | R3 |
| 15 | Concurrent Dev Setup | Root `package.json` running backend `tsx watch` and frontend Vite HMR concurrently | M4 | R4 |
| 16 | Root PowerShell Script `start.ps1` | Environment validation, dependency install, pre-flight test, concurrent start | M4 | R4 |
| 17 | Programmatic Verification Script | `npm run verify:mtproxy` MTProto 2.0 DH key exchange across DC1–DC5 | M1 | AC |
| 18 | No Unapproved Git Operations | Strict adherence to zero git add/commit/push | All | Rule 1 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Independent opaque-box test runner, test cases Tiers 1-4, `TEST_INFRA.md`, `TEST_READY.md` | none | DONE |
| M1 | Backend Bridge & Failover API | Port 8081 service, Obfuscated2 engine, `/mtproxy` relay, health checker, REST API, `npm run verify:mtproxy` | none | DONE |
| M2 | Telegram Web A Setup & GramJS Tunneling | Setup `telegram-tt`, patch `Connection.ts`, `PromisedWebSockets.ts`, `vite.config.ts` (CSP + 8080), `.env` | M1 interface | DONE |
| M3 | LizardTalk UI & MTProxy Manager | Status badge, manager modal, Teact mounting in `App.tsx`, branding, UI rule enforcement | M1, M2 | DONE |
| M4 | Root Script & Concurrent Dev Setup | Root `package.json`, `start.ps1` PowerShell script, concurrent hot-reload scripts | M1, M2, M3 | DONE |
| M5 | Final Acceptance & Adversarial Hardening | Pass 100% of E2E test suite (Tiers 1-4), then Tier 5 adversarial hardening | M1, M2, M3, M4, E2E | IN_PROGRESS |

---

## Interface Contracts

### 1. Frontend GramJS ↔ Backend WebSocket Relay (`/mtproxy`)
- **Protocol**: WebSocket (binary arraybuffer)
- **URL**: `ws://localhost:8081/mtproxy?dcId=${signedDcId}`
  - `dcId`: Signed integer. Positive `1..5` for standard DC connections; negative `-1..-5` for media DC connections.
  - Optional `raw=1`: If set, backend performs transparent raw TCP pass-through without applying Obfuscated2 handshake (used by raw testers).
- **Framing**: Standard MTProto Abridged transport frames (`0xef` header + payload length + MTProto message).
- **Lifecycle**: Frontend opens WebSocket -> Backend connects to active MTProxy via TCP, executes Obfuscated2 handshake with `signedDcId`, and begins bi-directional binary piping.

### 2. Frontend MTProxy UI ↔ Backend REST API (`/api/proxies`)
- **Base URL**: `http://localhost:8081`
- **Endpoints**:
  - `GET /api/proxies`: Returns `{ activeId: string, proxies: ProxyRecord[] }`
    - `ProxyRecord`: `{ id: string, host: string, port: number, secret: string, isDefault: boolean, isOnline: boolean, latencyMs: number | null, lastChecked: string (ISO 8601), error?: string }`
  - `POST /api/proxies`: Body `{ host: string, port: number, secret: string }` -> returns created `ProxyRecord`
  - `POST /api/proxies/active`: Body `{ id: string }` -> returns `{ success: true, activeId: string }`
  - `DELETE /api/proxies/:id`: Returns `{ success: true }`. Default proxy deletion is rejected with 403 Forbidden.
  - `GET /api/health`: Returns `{ status: 'ok', activeProxy: ProxyRecord }`

### 3. Verification Script Contract (`npm run verify:mtproxy`)
- **Command**: `npm run verify:mtproxy`
- **Execution**: Connects through `ws://localhost:8081/mtproxy` (or direct) to `54.255.212.228:443`, completes MTProto 2.0 DH key exchange (`req_pq_multi` -> `req_DH_params` -> `set_client_DH_params`), and verifies valid response across all DCs (DC1–DC5). Exit code 0 on success.

---

## Code Layout
```
c:\Users\desmo\Desktop\Skywalker\TalkPro\lizardtalk-web\
├── backend/
│   ├── src/
│   │   ├── crypto/
│   │   │   ├── obfuscated2.ts      # 64-byte handshake, AES-256-CTR, SHA256
│   │   │   ├── secrets.ts          # standard hex, dd intermediate, ee Fake-TLS
│   │   │   └── mtproto-dh.ts       # DH key exchange, Pollard rho, PQ factorization
│   │   ├── proxy/
│   │   │   ├── pool.ts             # Proxy pool state, persistence, failover
│   │   │   └── health.ts           # TCP + MTProto live health checks
│   │   ├── relay/
│   │   │   └── ws-relay.ts         # WebSocket-to-TCP binary stream relay
│   │   ├── routes/
│   │   │   └── api.ts              # REST API (/api/proxies, /api/health)
│   │   └── server.ts               # Express/HTTP + WebSocket entry point (port 8081)
│   ├── scripts/
│   │   └── verify-mtproxy.ts       # Standalone DH verification script
│   ├── tsconfig.json
│   └── package.json
├── src/                            # Telegram Web A Frontend (Teact)
│   ├── api/gramjs/                 # GramJS Web Worker integration
│   ├── components/
│   │   ├── App.tsx                 # Root application component
│   │   └── proxy/                  # LizardTalk MTProxy Manager UI
│   │       ├── MtProxyStatusBadge.tsx
│   │       ├── MtProxyManagerModal.tsx
│   │       └── MtProxyConfirmModal.tsx
│   ├── lib/gramjs/
│   │   ├── extensions/
│   │   │   └── PromisedWebSockets.ts # WebSocket tunnel hook
│   │   └── network/connection/
│   │       └── Connection.ts       # dcId propagation
│   ├── config.ts                   # LizardTalk branding & endpoints
│   └── assets/localization/
│       └── initialStrings.ts       # Branded strings
├── tests/
│   ├── e2e/                        # Opaque-box E2E test suite (Tiers 1-4)
│   │   ├── runner.ts               # Test runner harness
│   │   ├── tier1-feature/          # 5+ tests per feature
│   │   ├── tier2-boundary/         # Edge cases & boundaries
│   │   ├── tier3-combination/      # Cross-feature combinations
│   │   └── tier4-scenarios/        # Real-world application scenarios
├── .env                            # Environment variables
├── package.json                    # Root package.json (dev: concurrently)
├── start.ps1                       # Automated PowerShell launcher
├── vite.config.ts                  # Vite config (CSP patch, port 8080)
├── PROJECT.md                      # Project master index
├── TEST_INFRA.md                   # Test infrastructure index
└── TEST_READY.md                   # E2E test readiness publication
```
