import type { FC } from '../../lib/teact/teact';
import React, { useCallback, useEffect, useState } from '../../lib/teact/teact';

import type { ProxyListResponse, ProxyRecord } from './types';

import { MTPROXY_BRIDGE_HTTP } from '../../config';

import styles from './MtProxy.module.scss';

export interface MtProxyStatusBadgeProps {
  onOpenManager: () => void;
}

const MtProxyStatusBadge: FC<MtProxyStatusBadgeProps> = ({ onOpenManager }) => {
  const [activeProxy, setActiveProxy] = useState<ProxyRecord | undefined>(undefined);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const syncActiveProxy = useCallback(async () => {
    try {
      const response = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Proxy service returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as ProxyListResponse;
      if (!data || !Array.isArray(data.proxies)) {
        throw new Error('Invalid response structure received from proxy service');
      }

      const current = data.proxies.find((p) => p.id === data.activeId);
      if (current) {
        setActiveProxy(current);
        setHasError(false);
        setErrorMessage('');
      } else if (data.proxies.length > 0) {
        setActiveProxy(data.proxies[0]);
        setHasError(false);
        setErrorMessage('');
      } else {
        throw new Error('No proxies available in pool');
      }
    } catch (err: any) {
      setHasError(true);
      setErrorMessage(err?.message || 'Failed to connect to proxy bridge');
    }
  }, []);

  // Initial fetch on mount and automatic polling every 5 seconds
  useEffect(() => {
    syncActiveProxy();
    const intervalId = setInterval(syncActiveProxy, 5000);
    return () => clearInterval(intervalId);
  }, [syncActiveProxy]);

  const getStatusColorDot = () => {
    if (hasError || !activeProxy || !activeProxy.isOnline) {
      return `${styles.statusDot} ${styles.dotRed}`;
    }
    const latency = activeProxy.latencyMs;
    if (typeof latency === 'number' && latency < 300) {
      return `${styles.statusDot} ${styles.dotGreen}`;
    }
    if (typeof latency === 'number' && latency <= 1000) {
      return `${styles.statusDot} ${styles.dotYellow}`;
    }
    return `${styles.statusDot} ${styles.dotRed}`;
  };

  const renderBadgeContent = () => {
    if (hasError) {
      return (
        <>
          <span className={getStatusColorDot()} />
          <span className={styles.badgeOffline}>MTProxy: Offline</span>
        </>
      );
    }

    if (!activeProxy) {
      return (
        <>
          <span className={`${styles.statusDot} ${styles.dotYellow}`} />
          <span>MTProxy: Connecting...</span>
        </>
      );
    }

    const { host, port, latencyMs, isOnline } = activeProxy;
    const latencyText = isOnline && typeof latencyMs === 'number' ? `${latencyMs}ms` : 'Offline';

    return (
      <>
        <span className={getStatusColorDot()} />
        <span>{`${host}:${port}`}</span>
        <span>•</span>
        <span className={isOnline ? styles.badgeLatency : styles.badgeOffline}>
          {latencyText}
        </span>
      </>
    );
  };

  return (
    <div
      className={styles.proxyBadge}
      onClick={onOpenManager}
      role="button"
      tabIndex={0}
      title={hasError ? errorMessage : 'LizardTalk MTProxy Manager — Click to configure'}
    >
      {renderBadgeContent()}
    </div>
  );
};

export default MtProxyStatusBadge;
