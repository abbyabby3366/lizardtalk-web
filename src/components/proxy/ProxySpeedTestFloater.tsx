import {
  isMtProxyDisabled,
  NET_STATS_CHANNEL_NAME,
  notifyProxyConfigChanged,
} from '../../lib/gramjs/extensions/PromisedWebSockets';
import type { FC } from '../../lib/teact/teact';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from '../../lib/teact/teact';

import type { ProxyRecord } from './types';

import { MTPROXY_BRIDGE_HTTP } from '../../config';
import { formatDateGmt8, formatTimeGmt8 } from './formatters';

import styles from './ProxySpeedTestFloater.module.scss';

interface DiagnosticsResponse {
  rxBytes: number;
  txBytes: number;
  activeConnections: number;
  connectionsByDc: Record<string, number>;
  proxyEnabled?: boolean;
  activeProxy: ProxyRecord;
  serverMemoryMb: number;
  uptimeSeconds: number;
  timestamp: string;
}

interface PingTestResponse {
  isOnline: boolean;
  latencyMs?: number;
  dcId: number;
  proxyId: string;
  proxyHost: string;
  proxyPort: number;
  error?: string;
  timestamp: string;
}

type TooltipKey = 'throughput' | 'speedtest' | 'ping' | 'dcping' | 'diagnostics';

const FLOATER_SIZE = 70;
const EDGE_MARGIN = 8;
const STORAGE_KEY_X = 'lizardtalk_debug_floater_x';
const STORAGE_KEY_Y = 'lizardtalk_debug_floater_y';
const STORAGE_KEY_LANG = 'lizardtalk_debug_lang';
const SPEEDTEST_BYTES = 5_000_000;

function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '0 B/s';
  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)} B/s`;
  }
  const kb = bytesPerSec / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB/s`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB/s`;
}

function formatTotalBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

const TOOLTIP_CONTENT: Record<TooltipKey, {
  enTitle: string;
  enBody: string;
  zhTitle: string;
  zhBody: string;
}> = {
  throughput: {
    enTitle: 'Real-time Throughput',
    enBody: [
      'Shows live data transfer speed through the LizardTalk MTProxy bridge.',
      '',
      '• Rx Speed (Download): Incoming media, video streams, and messages from Telegram.',
      '• Tx Speed (Upload): Outgoing messages, uploads, and MTProto requests.',
      '',
      'Higher values mean faster media and video loading.',
    ].join('\n'),
    zhTitle: '实时吞吐量说明',
    zhBody: [
      '显示当前通过 LizardTalk MTProxy 代理桥接器的实时数据传输速率。',
      '',
      '• 下行速度 (下载)：接收视频流、图片和消息的速度。',
      '• 上行速度 (上传)：发送消息、上传文件及请求的速度。',
      '',
      '数值越高代表视频加载与传输越快。',
    ].join('\n'),
  },
  speedtest: {
    enTitle: 'Active 5MB Speed Test',
    enBody: [
      'Downloads a 5 MB test payload from the LizardTalk relay server to measure your maximum available bandwidth.',
      '',
      '• > 20 Mbps: Excellent (HD video & instant media)',
      '• 5 - 20 Mbps: Good (Smooth video playback)',
      '• < 5 Mbps: Slow (May experience buffering)',
    ].join('\n'),
    zhTitle: '主动测速说明',
    zhBody: [
      '通过从 LizardTalk 代理服务器下载 5MB 测试数据包，测量您当前网络的最大可用带宽。',
      '',
      '• > 20 Mbps：极佳（秒开高清视频与大图）',
      '• 5 - 20 Mbps：良好（流畅观看视频）',
      '• < 5 Mbps：较慢（大视频可能出现缓冲）',
    ].join('\n'),
  },
  ping: {
    enTitle: 'Ping & Stability',
    enBody: [
      'Sends 5 consecutive MTProto Obfuscated2 handshake probes to the active proxy server:',
      '',
      '• Average (Latency): Round-trip time in ms. (<150ms Good, >300ms Slow)',
      '• Jitter: Variation in latency between pings. (<30ms Stable, >80ms Unstable)',
      '• Loss (Packet Loss): Failed probes %. Should ideally be 0%.',
    ].join('\n'),
    zhTitle: '延迟与稳定性说明',
    zhBody: [
      '向当前代理服务器连续发送 5 次 MTProto Obfuscated2 握手探测包：',
      '',
      '• 平均延迟 (Average)：数据往返耗时。(<150ms 优秀，>300ms 较慢)',
      '• 抖动 (Jitter)：每次延迟的变化幅度。(<30ms 稳定，>80ms 网络波动大)',
      '• 丢包率 (Loss)：请求超时或失败的比例。理想状态应为 0%。',
    ].join('\n'),
  },
  dcping: {
    enTitle: 'Telegram DC Ping',
    enBody: [
      'Measures full round-trip latency through the active MTProxy to Telegram DC (req_pq_multi -> resPQ).',
      '',
      '• < 200 ms: Fast response',
      '• 200 - 400 ms: Normal cross-region proxy latency',
      '• > 400 ms: High latency',
    ].join('\n'),
    zhTitle: 'Telegram 服务器延迟说明',
    zhBody: [
      '测量通过当前 MTProxy 代理到达 Telegram 数据中心完成加密握手 (req_pq_multi -> resPQ) 的真实端到端延迟。',
      '',
      '• < 200 ms：响应迅速',
      '• 200 - 400 ms：跨区代理正常延迟',
      '• > 400 ms：延迟较高',
    ].join('\n'),
  },
  diagnostics: {
    enTitle: 'Connection Diagnostics',
    enBody: [
      'Displays real-time technical status of the LizardTalk proxy bridge:',
      '',
      '• Active Server IP: Current MTProxy host & port',
      '• Active WS Sockets: Concurrent MTProto DC channels (used for parallel video streaming)',
      '• Total Relayed: Cumulative downloaded/uploaded bytes',
      '• Memory Usage: Bridge process RSS memory',
    ].join('\n'),
    zhTitle: '连接与网络诊断说明',
    zhBody: [
      '显示 LizardTalk 代理桥接器的底层技术状态：',
      '',
      '• 节点 IP：当前连接的 MTProxy 服务器地址与端口',
      '• 活跃通道：当前并发的 MTProto 数据中心连接数（用于多线程视频并行加载）',
      '• 累计流量：本次会话累计上下行流量',
      '• 内存占用：后端桥接服务内存占用',
    ].join('\n'),
  },
};

const ProxySpeedTestFloater: FC = () => {
  // Position state for draggable 70x70 floater
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const defaultX = typeof window !== 'undefined'
      ? Math.max(EDGE_MARGIN, window.innerWidth - FLOATER_SIZE - 18)
      : 20;
    const defaultY = typeof window !== 'undefined'
      ? Math.max(EDGE_MARGIN, window.innerHeight - FLOATER_SIZE - 90)
      : 200;
    if (typeof window === 'undefined') return { x: defaultX, y: defaultY };
    const savedX = Number(localStorage.getItem(STORAGE_KEY_X));
    const savedY = Number(localStorage.getItem(STORAGE_KEY_Y));
    const x = Number.isFinite(savedX) && savedX > 0
      ? Math.min(Math.max(EDGE_MARGIN, savedX), window.innerWidth - FLOATER_SIZE - EDGE_MARGIN)
      : defaultX;
    const y = Number.isFinite(savedY) && savedY > 0
      ? Math.min(Math.max(EDGE_MARGIN, savedY), window.innerHeight - FLOATER_SIZE - EDGE_MARGIN)
      : defaultY;
    return { x, y };
  });

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isChinese, setIsChinese] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY_LANG) === 'zh';
  });
  const [activeTooltip, setActiveTooltip] = useState<TooltipKey | undefined>(undefined);

  // Live stats state
  const [rxSpeed, setRxSpeed] = useState<number>(0);
  const [txSpeed, setTxSpeed] = useState<number>(0);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | undefined>(undefined);
  const [diagError, setDiagError] = useState<string>('');
  const [isProxyEnabled, setIsProxyEnabled] = useState<boolean>(() => !isMtProxyDisabled());
  const [isTogglingMode, setIsTogglingMode] = useState<boolean>(false);
  const [modeError, setModeError] = useState<string>('');
  const [clientStats, setClientStats] = useState<{
    rxBytes: number;
    txBytes: number;
    activeConnections: number;
    connectionsByDc: Record<string, number>;
  }>({
    rxBytes: 0,
    txBytes: 0,
    activeConnections: 0,
    connectionsByDc: {},
  });

  // Speed Test state
  const [isSpeedTesting, setIsSpeedTesting] = useState<boolean>(false);
  const [speedProgress, setSpeedProgress] = useState<number>(0);
  const [speedDownloadedMb, setSpeedDownloadedMb] = useState<number>(0);
  const [speedCurrentMbps, setSpeedCurrentMbps] = useState<number>(0);
  const [speedFinalMbps, setSpeedFinalMbps] = useState<number | undefined>(undefined);
  const [speedError, setSpeedError] = useState<string>('');

  // 5-Ping Stability Test state
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [pingStep, setPingStep] = useState<number>(0);
  const [pingAvg, setPingAvg] = useState<number | undefined>(undefined);
  const [pingJitter, setPingJitter] = useState<number | undefined>(undefined);
  const [pingLoss, setPingLoss] = useState<number | undefined>(undefined);
  const [pingError, setPingError] = useState<string>('');

  // Telegram DC Ping state
  const [isDcPinging, setIsDcPinging] = useState<boolean>(false);
  const [dcPingMs, setDcPingMs] = useState<number | undefined>(undefined);
  const [dcPingTimestamp, setDcPingTimestamp] = useState<number | undefined>(undefined);
  const [dcPingError, setDcPingError] = useState<string>('');

  // Refs for throughput delta calculation & drag tracking
  const lastRxBytesRef = useRef<number | undefined>(undefined);
  const lastTxBytesRef = useRef<number | undefined>(undefined);
  const lastStatsTimeRef = useRef<number | undefined>(undefined);
  const clientRxBytesRef = useRef<number>(0);
  const clientTxBytesRef = useRef<number>(0);
  const lastClientRxBytesRef = useRef<number>(0);
  const lastClientTxBytesRef = useRef<number>(0);
  const speedHistoryRef = useRef<Array<{ t: number; dRx: number; dTx: number }>>([]);
  const lastNonZeroRxTimeRef = useRef<number>(0);
  const lastNonZeroTxTimeRef = useRef<number>(0);
  const speedAbortRef = useRef<AbortController | undefined>(undefined);
  const isSpeedTestingRef = useRef<boolean>(false);

  const dragStateRef = useRef<{
    isPointerDown: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    hasMoved: boolean;
  }>({
    isPointerDown: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    hasMoved: false,
  });

  // Keep floater within viewport on window resize
  useEffect(() => {
    const handleResize = () => {
      setPos((prev) => ({
        x: Math.min(Math.max(EDGE_MARGIN, prev.x), window.innerWidth - FLOATER_SIZE - EDGE_MARGIN),
        y: Math.min(Math.max(EDGE_MARGIN, prev.y), window.innerHeight - FLOATER_SIZE - EDGE_MARGIN),
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Subscribe to client-side WebSocket telemetry from PromisedWebSockets (works in both MTProxy & Direct/VPN modes)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(NET_STATS_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'proxyModeChanged' && typeof msg.proxyDisabled === 'boolean') {
        setIsProxyEnabled(!msg.proxyDisabled);
      } else if (msg.type === 'clientNetStats') {
        clientRxBytesRef.current = msg.rxBytes || 0;
        clientTxBytesRef.current = msg.txBytes || 0;
        setClientStats({
          rxBytes: msg.rxBytes || 0,
          txBytes: msg.txBytes || 0,
          activeConnections: msg.activeConnections || 0,
          connectionsByDc: msg.connectionsByDc || {},
        });
      }
    };
    return () => channel.close();
  }, []);

  const updateSmoothedThroughput = useCallback((now: number, backendDRx: number, backendDTx: number) => {
    const clientDRx = Math.max(0, clientRxBytesRef.current - lastClientRxBytesRef.current);
    const clientDTx = Math.max(0, clientTxBytesRef.current - lastClientTxBytesRef.current);
    lastClientRxBytesRef.current = clientRxBytesRef.current;
    lastClientTxBytesRef.current = clientTxBytesRef.current;

    const dRx = Math.max(backendDRx, clientDRx);
    const dTx = Math.max(backendDTx, clientDTx);

    if (dRx > 0) lastNonZeroRxTimeRef.current = now;
    if (dTx > 0) lastNonZeroTxTimeRef.current = now;

    const windowMs = 3000;
    speedHistoryRef.current.push({ t: now, dRx, dTx });
    speedHistoryRef.current = speedHistoryRef.current.filter((item) => now - item.t <= windowMs);

    const oldestTime = speedHistoryRef.current[0]?.t ?? (now - 1000);
    const spanSec = Math.max(1, (now - oldestTime) / 1000);
    const sumRx = speedHistoryRef.current.reduce((acc, s) => acc + s.dRx, 0);
    const sumTx = speedHistoryRef.current.reduce((acc, s) => acc + s.dTx, 0);

    const rollingRx = sumRx / spanSec;
    const rollingTx = sumTx / spanSec;

    if (!isSpeedTestingRef.current) {
      if (now - lastNonZeroRxTimeRef.current > 2200) {
        setRxSpeed(0);
      } else {
        setRxSpeed((prev) => (prev > 0 ? prev * 0.45 + rollingRx * 0.55 : rollingRx));
      }
    }

    if (now - lastNonZeroTxTimeRef.current > 2200) {
      setTxSpeed(0);
    } else {
      setTxSpeed((prev) => (prev > 0 ? prev * 0.45 + rollingTx * 0.55 : rollingTx));
    }
  }, []);

  // Poll /api/diagnostics every 1 second for live Rx/Tx speed & connection diagnostics
  const pollDiagnostics = useCallback(async () => {
    const now = performance.now();
    try {
      const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/diagnostics`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Diagnostics HTTP ${res.status}`);
      }
      const data = (await res.json()) as DiagnosticsResponse;

      if (typeof data.proxyEnabled === 'boolean') {
        const nextDisabled = !data.proxyEnabled;
        setIsProxyEnabled(data.proxyEnabled);
        if (isMtProxyDisabled() !== nextDisabled) {
          notifyProxyConfigChanged(nextDisabled, true);
        }
      }

      let dRx = 0;
      let dTx = 0;
      if (
        lastRxBytesRef.current !== undefined
        && lastTxBytesRef.current !== undefined
        && lastStatsTimeRef.current !== undefined
      ) {
        dRx = Math.max(0, data.rxBytes - lastRxBytesRef.current);
        dTx = Math.max(0, data.txBytes - lastTxBytesRef.current);
      }

      lastRxBytesRef.current = data.rxBytes;
      lastTxBytesRef.current = data.txBytes;
      lastStatsTimeRef.current = now;
      updateSmoothedThroughput(now, dRx, dTx);
      setDiagnostics(data);
      setDiagError('');

      if (
        dcPingMs === undefined
        && data.activeProxy?.isOnline
        && typeof data.activeProxy.latencyMs === 'number'
      ) {
        setDcPingMs(data.activeProxy.latencyMs);
        setDcPingTimestamp(
          data.activeProxy.lastChecked ? new Date(data.activeProxy.lastChecked).getTime() : Date.now(),
        );
      }
    } catch (err: any) {
      updateSmoothedThroughput(now, 0, 0);
      setDiagError(err?.message || 'Unable to reach proxy diagnostics service');
    }
  }, [dcPingMs, updateSmoothedThroughput]);

  useEffect(() => {
    void pollDiagnostics();
    const timer = setInterval(() => {
      void pollDiagnostics();
    }, 1000);
    return () => {
      clearInterval(timer);
      speedAbortRef.current?.abort();
    };
  }, [pollDiagnostics]);

  // Pointer drag handlers on the 70x70 floater button
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      isPointerDown: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      hasMoved: false,
    };

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      if (!dragStateRef.current.isPointerDown || moveEvent.pointerId !== dragStateRef.current.pointerId) {
        return;
      }
      const dx = moveEvent.clientX - dragStateRef.current.startX;
      const dy = moveEvent.clientY - dragStateRef.current.startY;
      if (!dragStateRef.current.hasMoved && Math.hypot(dx, dy) > 5) {
        dragStateRef.current.hasMoved = true;
        setIsDragging(true);
      }
      if (dragStateRef.current.hasMoved) {
        const nextX = Math.min(
          Math.max(EDGE_MARGIN, dragStateRef.current.originX + dx),
          window.innerWidth - FLOATER_SIZE - EDGE_MARGIN,
        );
        const nextY = Math.min(
          Math.max(EDGE_MARGIN, dragStateRef.current.originY + dy),
          window.innerHeight - FLOATER_SIZE - EDGE_MARGIN,
        );
        setPos({ x: nextX, y: nextY });
      }
    };

    const handleWindowPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== dragStateRef.current.pointerId) return;
      const wasMoved = dragStateRef.current.hasMoved;
      dragStateRef.current.isPointerDown = false;
      setIsDragging(false);

      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);

      if (wasMoved) {
        const dx = upEvent.clientX - dragStateRef.current.startX;
        const dy = upEvent.clientY - dragStateRef.current.startY;
        const finalX = Math.min(
          Math.max(EDGE_MARGIN, dragStateRef.current.originX + dx),
          window.innerWidth - FLOATER_SIZE - EDGE_MARGIN,
        );
        const finalY = Math.min(
          Math.max(EDGE_MARGIN, dragStateRef.current.originY + dy),
          window.innerHeight - FLOATER_SIZE - EDGE_MARGIN,
        );
        localStorage.setItem(STORAGE_KEY_X, String(Math.round(finalX)));
        localStorage.setItem(STORAGE_KEY_Y, String(Math.round(finalY)));
      } else {
        setIsInspectorOpen(true);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  }, [pos.x, pos.y]);

  const handleToggleLanguage = useCallback(() => {
    setIsChinese((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_LANG, next ? 'zh' : 'en');
      return next;
    });
  }, []);

  // Active 5MB Speed Test (streams 5MB from /api/speedtest with ReadableStream progress)
  const handleRunSpeedTest = useCallback(async () => {
    if (isSpeedTesting) return;
    speedAbortRef.current?.abort();
    const controller = new AbortController();
    speedAbortRef.current = controller;

    setIsSpeedTesting(true);
    isSpeedTestingRef.current = true;
    setSpeedProgress(0);
    setSpeedDownloadedMb(0);
    setSpeedCurrentMbps(0);
    setSpeedFinalMbps(undefined);
    setSpeedError('');

    const startTime = performance.now();
    let receivedBytes = 0;

    try {
      const res = await fetch(
        `${MTPROXY_BRIDGE_HTTP}/api/speedtest?bytes=${SPEEDTEST_BYTES}&t=${Date.now()}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        throw new Error(`Speed test failed with HTTP ${res.status}`);
      }

      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            receivedBytes += value.byteLength;
            const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
            const bps = receivedBytes / elapsedSec;
            const mbps = (bps * 8) / 1_000_000;
            setSpeedProgress(Math.min(100, (receivedBytes / SPEEDTEST_BYTES) * 100));
            setSpeedDownloadedMb(receivedBytes / 1_000_000);
            setSpeedCurrentMbps(mbps);
            setRxSpeed(bps);
          }
        }
      } else {
        const buf = await res.arrayBuffer();
        receivedBytes = buf.byteLength;
      }

      const totalSec = Math.max(0.05, (performance.now() - startTime) / 1000);
      const finalMbps = ((receivedBytes * 8) / 1_000_000) / totalSec;
      setSpeedProgress(100);
      setSpeedDownloadedMb(receivedBytes / 1_000_000);
      setSpeedFinalMbps(finalMbps);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setSpeedError(err?.message || (isChinese ? '测速请求失败' : 'Speed test failed'));
      }
    } finally {
      isSpeedTestingRef.current = false;
      setIsSpeedTesting(false);
    }
  }, [isSpeedTesting, isChinese]);

  // 5-Ping Stability Test
  const handleRunPingTest = useCallback(async () => {
    if (isPinging) return;
    setIsPinging(true);
    setPingStep(0);
    setPingAvg(undefined);
    setPingJitter(undefined);
    setPingLoss(undefined);
    setPingError('');

    const totalPings = 5;
    const rtts: number[] = [];
    let lostCount = 0;

    try {
      for (let i = 1; i <= totalPings; i++) {
        setPingStep(i);
        try {
          const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/ping-test`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ dcId: 2 }),
          });

          if (!res.ok) {
            lostCount += 1;
          } else {
            const data = (await res.json()) as PingTestResponse;
            if (data.isOnline && typeof data.latencyMs === 'number') {
              rtts.push(data.latencyMs);
              setDcPingMs(data.latencyMs);
              setDcPingTimestamp(Date.now());
            } else {
              lostCount += 1;
            }
          }
        } catch {
          lostCount += 1;
        }
      }

      const lossPercent = Math.round((lostCount / totalPings) * 100);
      setPingLoss(lossPercent);

      if (rtts.length > 0) {
        const sum = rtts.reduce((acc, v) => acc + v, 0);
        const avg = Math.round(sum / rtts.length);
        setPingAvg(avg);

        if (rtts.length > 1) {
          let diffSum = 0;
          for (let j = 1; j < rtts.length; j++) {
            diffSum += Math.abs(rtts[j] - rtts[j - 1]);
          }
          setPingJitter(Math.round(diffSum / (rtts.length - 1)));
        } else {
          setPingJitter(0);
        }
      } else {
        setPingError(
          isChinese
            ? '所有 5 次代理握手探测均超时或失败'
            : 'All 5 MTProxy handshake probes timed out or failed',
        );
      }
    } finally {
      setIsPinging(false);
    }
  }, [isPinging, isChinese]);

  // Single Telegram DC Ping
  const handleRunDcPing = useCallback(async () => {
    if (isDcPinging) return;
    setIsDcPinging(true);
    setDcPingError('');

    try {
      const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/ping-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ dcId: 5 }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as PingTestResponse;
      if (data.isOnline && typeof data.latencyMs === 'number') {
        setDcPingMs(data.latencyMs);
        setDcPingTimestamp(Date.now());
      } else {
        throw new Error(data.error || (isChinese ? '连接超时' : 'Connection timed out'));
      }
    } catch (err: any) {
      setDcPingError(err?.message || (isChinese ? 'Telegram DC 探测失败' : 'Telegram DC probe failed'));
    } finally {
      setIsDcPinging(false);
    }
  }, [isDcPinging, isChinese]);

  const handleToggleProxyMode = useCallback(async () => {
    if (isTogglingMode) return;
    const nextEnabled = !isProxyEnabled;
    setIsTogglingMode(true);
    setModeError('');
    try {
      let bridgeError: string | undefined;
      try {
        const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled }),
        });
        if (!res.ok) {
          bridgeError = `HTTP ${res.status}`;
        }
      } catch (err: any) {
        bridgeError = err?.message || 'Network error';
      }

      if (bridgeError && nextEnabled) {
        // MTProxy mode cannot work without the bridge, so stay in Direct / VPN mode and say why
        setModeError(isChinese
          ? `无法开启 MTProto 代理：代理桥接服务不可用 (${bridgeError})`
          : `Could not enable MTProto Proxy: proxy bridge is unreachable (${bridgeError})`);
        return;
      }

      if (bridgeError) {
        // Direct / VPN mode does not need the bridge, so switch locally but tell the user it was not saved
        setModeError(isChinese
          ? `已在本机切换至 VPN 直连，但代理桥接服务不可用，设置未保存到服务器 (${bridgeError})`
          : `Switched to Direct / VPN locally, but the proxy bridge is unreachable so it was not saved (${
            bridgeError
          })`);
      }

      setIsProxyEnabled(nextEnabled);
      notifyProxyConfigChanged(!nextEnabled, true);
      void pollDiagnostics();
    } finally {
      setIsTogglingMode(false);
    }
  }, [isProxyEnabled, isTogglingMode, isChinese, pollDiagnostics]);

  // Active latency display on the 70x70 floater button
  const proxyLatency = diagnostics?.activeProxy?.latencyMs;
  const activeLatency = dcPingMs ?? (typeof proxyLatency === 'number' ? proxyLatency : undefined);
  const isProxyOnline = diagnostics?.activeProxy?.isOnline ?? false;

  const getLatencyColorClass = (ms: number | undefined, online = true) => {
    if (!isProxyEnabled) return styles.colorCyan;
    if (!online || ms === undefined) return styles.colorRed;
    if (ms < 150) return styles.colorGreen;
    if (ms < 350) return styles.colorYellow;
    return styles.colorRed;
  };

  const renderFloaterPingText = () => {
    if (!isProxyEnabled) {
      return isChinese ? '直连 VPN' : 'Direct';
    }
    const prefix = isChinese ? '延迟:' : 'Ping:';
    if (!diagnostics && diagError) {
      return `${prefix} Off`;
    }
    if (!isProxyOnline || activeLatency === undefined) {
      return `${prefix} --`;
    }
    return `${prefix} ${activeLatency}ms`;
  };

  const renderDcPingDisplay = () => {
    if (isDcPinging) {
      return isChinese ? '正在测量...' : 'Measuring...';
    }
    if (dcPingMs === undefined) {
      return 'N/A';
    }
    const elapsedSec = dcPingTimestamp ? Math.max(0, Math.floor((Date.now() - dcPingTimestamp) / 1000)) : 0;
    const relStr = elapsedSec < 5
      ? (isChinese ? '刚刚' : 'Just now')
      : (isChinese ? `${elapsedSec}秒前` : `${elapsedSec}s ago`);
    return `${dcPingMs} ms (${relStr})`;
  };

  const renderSpeedStatusText = () => {
    if (speedError) {
      return speedError;
    }
    if (isSpeedTesting) {
      return isChinese
        ? `正在下载: ${speedDownloadedMb.toFixed(1)} MB / 5.0 MB (${speedCurrentMbps.toFixed(1)} Mbps)`
        : `Downloading: ${speedDownloadedMb.toFixed(1)} MB / 5.0 MB (${speedCurrentMbps.toFixed(1)} Mbps)`;
    }
    if (speedFinalMbps !== undefined) {
      return isChinese
        ? `测速完成: ${speedFinalMbps.toFixed(2)} Mbps`
        : `Speed Test Complete: ${speedFinalMbps.toFixed(2)} Mbps`;
    }
    return isChinese ? '准备测速' : 'Ready to test';
  };

  const effectiveConnectionsByDc = isProxyEnabled && (diagnostics?.activeConnections || 0) > 0
    ? diagnostics!.connectionsByDc
    : clientStats.connectionsByDc;
  const effectiveActiveConnections = isProxyEnabled
    ? Math.max(diagnostics?.activeConnections || 0, clientStats.activeConnections || 0)
    : clientStats.activeConnections;
  const effectiveRxBytes = Math.max(diagnostics?.rxBytes || 0, clientStats.rxBytes || 0);
  const effectiveTxBytes = Math.max(diagnostics?.txBytes || 0, clientStats.txBytes || 0);

  const dcChannelsSummary = effectiveConnectionsByDc
    ? Object.entries(effectiveConnectionsByDc)
      .map(([dc, count]) => `${dc}:${count}`)
      .join(', ')
    : '';

  const lastCheckedIso = diagnostics?.activeProxy?.lastChecked || diagnostics?.timestamp;

  return (
    <>
      {/* Draggable 70x70 Circular Speed Test Floater */}
      <div
        className={`${styles.floaterBadge} ${isDragging ? styles.floaterDragging : ''}`}
        style={`left: ${pos.x}px; top: ${pos.y}px;`}
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        title={isChinese ? '点击打开代理测速与诊断面板' : 'Click to open Proxy Speed Test & Inspector'}
      >
        <span className={styles.floaterRx}>{`↓ ${formatSpeed(rxSpeed)}`}</span>
        <span className={styles.floaterTx}>{`↑ ${formatSpeed(txSpeed)}`}</span>
        <span className={`${styles.floaterPing} ${getLatencyColorClass(activeLatency, isProxyOnline)}`}>
          {renderFloaterPingText()}
        </span>
      </div>

      {/* Inspector Modal */}
      {isInspectorOpen && (
        <div
          className={styles.inspectorBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsInspectorOpen(false);
            }
          }}
        >
          <div className={styles.inspectorContainer}>
            {/* Header */}
            <div className={styles.inspectorHeader}>
              <h2 className={styles.inspectorTitle}>
                {isChinese ? 'LizardTalk 代理检测器' : 'LizardTalk Proxy Inspector'}
              </h2>
              <div className={styles.headerControls}>
                <button
                  type="button"
                  className={styles.langButton}
                  onClick={handleToggleLanguage}
                >
                  {isChinese ? 'English' : '中/EN'}
                </button>
                <button
                  type="button"
                  className={styles.closeCircleButton}
                  onClick={() => setIsInspectorOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable Cards */}
            <div className={styles.inspectorScroll}>
              {diagError && (
                <div className={styles.errorBanner}>
                  {diagError}
                </div>
              )}

              {/* Section A: Real-time Throughput */}
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    {isChinese ? '实时吞吐量' : 'Real-time Throughput'}
                  </span>
                  <button
                    type="button"
                    className={styles.infoButton}
                    onClick={() => setActiveTooltip('throughput')}
                    title={isChinese ? '查看说明' : 'Info'}
                  >
                    ⓘ
                  </button>
                </div>
                <div className={styles.throughputGrid}>
                  <div className={styles.throughputItem}>
                    <span className={styles.throughputSub}>
                      {isChinese ? '下行速度 (下载)' : 'Rx Speed (Download)'}
                    </span>
                    <span className={styles.throughputValRx}>
                      {formatSpeed(rxSpeed)}
                    </span>
                  </div>
                  <div className={styles.throughputItem}>
                    <span className={styles.throughputSub}>
                      {isChinese ? '上行速度 (上传)' : 'Tx Speed (Upload)'}
                    </span>
                    <span className={styles.throughputValTx}>
                      {formatSpeed(txSpeed)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section B: Active 5MB Speed Test */}
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    {isChinese ? '主动测速' : 'Active Speed Test'}
                  </span>
                  <button
                    type="button"
                    className={styles.infoButton}
                    onClick={() => setActiveTooltip('speedtest')}
                    title={isChinese ? '查看说明' : 'Info'}
                  >
                    ⓘ
                  </button>
                </div>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.btnSpeedTest}`}
                  disabled={isSpeedTesting}
                  onClick={handleRunSpeedTest}
                >
                  {isSpeedTesting
                    ? (isChinese ? '测速中...' : 'Testing...')
                    : (isChinese ? '运行 5MB 速度测试' : 'Run 5MB Speed Test')}
                </button>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFillSpeed}
                    style={`transform: scaleX(${speedProgress / 100});`}
                  />
                </div>
                <div
                  className={`${styles.speedStatusText} ${
                    speedError
                      ? styles.colorRed
                      : speedFinalMbps !== undefined
                        ? styles.colorCyan
                        : ''
                  }`}
                >
                  {renderSpeedStatusText()}
                </div>
              </div>

              {/* Section C: Ping & Stability + Telegram DC Ping */}
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    {isChinese ? '延迟与稳定性' : 'Ping & Stability'}
                  </span>
                  <button
                    type="button"
                    className={styles.infoButton}
                    onClick={() => setActiveTooltip('ping')}
                    title={isChinese ? '查看说明' : 'Info'}
                  >
                    ⓘ
                  </button>
                </div>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.btnPingTest}`}
                  disabled={isPinging}
                  onClick={handleRunPingTest}
                >
                  {isPinging
                    ? (isChinese ? `正在 Ping (${pingStep}/5)...` : `Pinging (${pingStep}/5)...`)
                    : (isChinese ? '运行 5次 Ping 测试' : 'Run 5-Ping Test')}
                </button>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFillPing}
                    style={`transform: scaleX(${pingStep / 5});`}
                  />
                </div>

                {pingError && (
                  <div className={styles.errorBanner}>
                    {pingError}
                  </div>
                )}

                <div className={styles.pingMetricsGrid}>
                  <div className={styles.pingMetricCol}>
                    <span className={styles.pingMetricSub}>
                      {isChinese ? '平均延迟' : 'Average'}
                    </span>
                    <span
                      className={`${styles.pingMetricVal} ${
                        pingAvg === undefined
                          ? ''
                          : pingAvg < 150
                            ? styles.colorGreen
                            : pingAvg < 300
                              ? styles.colorYellow
                              : styles.colorRed
                      }`}
                    >
                      {pingAvg !== undefined ? `${pingAvg} ms` : '-- ms'}
                    </span>
                  </div>
                  <div className={styles.pingMetricCol}>
                    <span className={styles.pingMetricSub}>
                      {isChinese ? '抖动' : 'Jitter'}
                    </span>
                    <span
                      className={`${styles.pingMetricVal} ${
                        pingJitter === undefined
                          ? ''
                          : pingJitter < 30
                            ? styles.colorGreen
                            : pingJitter < 80
                              ? styles.colorYellow
                              : styles.colorRed
                      }`}
                    >
                      {pingJitter !== undefined ? `${pingJitter} ms` : '-- ms'}
                    </span>
                  </div>
                  <div className={styles.pingMetricCol}>
                    <span className={styles.pingMetricSub}>
                      {isChinese ? '丢包率' : 'Loss'}
                    </span>
                    <span
                      className={`${styles.pingMetricVal} ${
                        pingLoss === undefined
                          ? ''
                          : pingLoss === 0
                            ? styles.colorGreen
                            : pingLoss < 20
                              ? styles.colorYellow
                              : styles.colorRed
                      }`}
                    >
                      {pingLoss !== undefined ? `${pingLoss}%` : '--%'}
                    </span>
                  </div>
                </div>

                <div className={styles.cardDivider} />

                {/* Telegram DC Ping Sub-section */}
                <div className={styles.dcPingHeader}>
                  <div className={styles.dcPingTitleGroup}>
                    <span className={styles.dcPingTitle}>
                      {isChinese ? 'Telegram 服务器延迟' : 'Telegram DC Ping'}
                    </span>
                    <button
                      type="button"
                      className={styles.infoButton}
                      onClick={() => setActiveTooltip('dcping')}
                      title={isChinese ? '查看说明' : 'Info'}
                    >
                      ⓘ
                    </button>
                  </div>
                  <span
                    className={`${styles.dcPingValue} ${
                      dcPingMs === undefined
                        ? styles.colorMuted
                        : dcPingMs < 200
                          ? styles.colorGreen
                          : dcPingMs < 400
                            ? styles.colorYellow
                            : styles.colorRed
                    }`}
                  >
                    {renderDcPingDisplay()}
                  </span>
                </div>

                {dcPingError && (
                  <div className={styles.errorBanner}>
                    {dcPingError}
                  </div>
                )}

                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.btnDcPing}`}
                  disabled={isDcPinging}
                  onClick={handleRunDcPing}
                >
                  {isDcPinging
                    ? (isChinese ? '正在测量...' : 'Measuring...')
                    : (isChinese ? '测试 Telegram 延迟' : 'Ping Telegram DC')}
                </button>
              </div>

              {/* Section D: Connection Diagnostics */}
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    {isChinese ? '连接与网络诊断' : 'Connection Diagnostics'}
                  </span>
                  <button
                    type="button"
                    className={styles.infoButton}
                    onClick={() => setActiveTooltip('diagnostics')}
                    title={isChinese ? '查看说明' : 'Info'}
                  >
                    ⓘ
                  </button>
                </div>
                <div className={styles.diagBox}>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '连接模式:' : 'Connection Mode:'}
                    </span>
                    <span className={`${styles.diagValue} ${isProxyEnabled ? styles.colorGreen : styles.colorCyan}`}>
                      {isProxyEnabled
                        ? (isChinese ? 'MTProto 代理桥接' : 'MTProto Proxy Bridge')
                        : (isChinese ? '直连模式 (VPN / Direct)' : 'Direct Mode (VPN)')}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '当前节点 IP:' : 'Active Server IP:'}
                    </span>
                    <span className={styles.diagValue}>
                      {!isProxyEnabled
                        ? 'wss://zws1..5.web.telegram.org'
                        : diagnostics?.activeProxy
                          ? `${diagnostics.activeProxy.host}:${diagnostics.activeProxy.port}`
                          : '—'}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '节点状态:' : 'Proxy Status:'}
                    </span>
                    <span
                      className={`${styles.diagValue} ${
                        !isProxyEnabled
                          ? styles.colorCyan
                          : diagnostics?.activeProxy?.isOnline
                            ? styles.colorGreen
                            : styles.colorRed
                      }`}
                    >
                      {!isProxyEnabled
                        ? (isChinese ? '已手动关闭 (VPN 直连)' : 'Manually Off (Direct / VPN)')
                        : diagnostics?.activeProxy
                          ? (diagnostics.activeProxy.isOnline
                            ? (isChinese ? '在线 (Obfuscated2)' : 'Online (Obfuscated2)')
                            : (isChinese ? '离线' : 'Offline'))
                          : '—'}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '活跃并发通道:' : 'Active WS Channels:'}
                    </span>
                    <span className={styles.diagValue}>
                      {`${effectiveActiveConnections}${dcChannelsSummary ? ` (${dcChannelsSummary})` : ''}`}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '累计转发流量:' : 'Total Relayed:'}
                    </span>
                    <span className={styles.diagValue}>
                      {`↓ ${formatTotalBytes(effectiveRxBytes)} / ↑ ${formatTotalBytes(effectiveTxBytes)}`}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '服务内存占用:' : 'Bridge Memory:'}
                    </span>
                    <span className={styles.diagValue}>
                      {diagnostics ? `${diagnostics.serverMemoryMb.toFixed(1)} MB` : '—'}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span className={styles.diagLabel}>
                      {isChinese ? '最近检测时间 (GMT+8):' : 'Last Checked (GMT+8):'}
                    </span>
                    <div className={styles.diagTimeStack}>
                      <span className={styles.diagTimePrimary}>
                        {formatTimeGmt8(lastCheckedIso)}
                      </span>
                      <span className={styles.diagDateSecondary}>
                        {formatDateGmt8(lastCheckedIso)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`${styles.actionButton} ${
                    isProxyEnabled ? styles.btnProxyToggleOff : styles.btnProxyToggleOn
                  }`}
                  disabled={isTogglingMode}
                  onClick={handleToggleProxyMode}
                >
                  {isProxyEnabled
                    ? (isChinese ? '关闭 MTProto 代理 (切换至 VPN 直连)' : 'Turn Off Proxy (Use Direct / VPN)')
                    : (isChinese ? '开启 MTProto 代理桥接' : 'Enable MTProto Proxy')}
                </button>
                {modeError && (
                  <div className={styles.errorBanner}>
                    {modeError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metric Info Tooltip Modal */}
      {activeTooltip && (
        <div
          className={styles.tooltipBackdrop}
          onClick={() => setActiveTooltip(undefined)}
        >
          <div
            className={styles.tooltipCard}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.tooltipTitle}>
              {isChinese
                ? TOOLTIP_CONTENT[activeTooltip].zhTitle
                : TOOLTIP_CONTENT[activeTooltip].enTitle}
            </h3>
            <p className={styles.tooltipBody}>
              {isChinese
                ? TOOLTIP_CONTENT[activeTooltip].zhBody
                : TOOLTIP_CONTENT[activeTooltip].enBody}
            </p>
            <button
              type="button"
              className={styles.tooltipOkBtn}
              onClick={() => setActiveTooltip(undefined)}
            >
              {isChinese ? '知道了' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ProxySpeedTestFloater;
