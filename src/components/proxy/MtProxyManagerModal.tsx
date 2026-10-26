import type { FormEvent } from 'react';
import type { FC } from '../../lib/teact/teact';
import React, { useCallback, useEffect, useState } from '../../lib/teact/teact';

import type { ProxyListResponse, ProxyRecord } from './types';

import { MTPROXY_BRIDGE_HTTP } from '../../config';
import { formatDateGmt8, formatTimeGmt8 } from './formatters';

import MtProxyConfirmModal from './MtProxyConfirmModal';

import styles from './MtProxy.module.scss';

export interface MtProxyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MtProxyManagerModal: FC<MtProxyManagerModalProps> = ({ isOpen, onClose }) => {
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string>('');
  const [apiSuccess, setApiSuccess] = useState<string>('');

  // Form state for adding new proxy
  const [newHost, setNewHost] = useState<string>('');
  const [newPort, setNewPort] = useState<string>('443');
  const [newSecret, setNewSecret] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Deletion confirmation state
  const [proxyToDelete, setProxyToDelete] = useState<ProxyRecord | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Synchronize proxy pool data from backend REST API
  const syncProxies = useCallback(async () => {
    try {
      const response = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to load proxies: HTTP ${response.status}`);
      }

      const data = (await response.json()) as ProxyListResponse;
      if (!data || !Array.isArray(data.proxies)) {
        throw new Error('Invalid proxy data structure received from server');
      }

      setProxies(data.proxies);
      setActiveId(data.activeId);
      setApiError('');
    } catch (err: any) {
      setApiError(err?.message || 'Error communicating with proxy service');
    }
  }, []);

  // Sync on open and poll every 5000ms
  useEffect(() => {
    if (!isOpen) return undefined;

    syncProxies();
    const interval = setInterval(syncProxies, 5000);
    return () => clearInterval(interval);
  }, [isOpen, syncProxies]);

  // Set active proxy handler
  const handleSetActive = async (id: string) => {
    setIsLoading(true);
    setApiError('');
    setApiSuccess('');
    try {
      const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Failed to activate proxy (${res.status})`);
      }

      setActiveId(id);
      setApiSuccess(`Switched active proxy successfully.`);
      await syncProxies();
    } catch (err: any) {
      setApiError(err?.message || 'Could not switch active proxy');
    } finally {
      setIsLoading(false);
    }
  };

  // Add new proxy handler
  const handleAddProxy = async (e: FormEvent) => {
    e.preventDefault();
    if (!newHost.trim() || !newPort.trim() || !newSecret.trim()) {
      setApiError('All fields (Host, Port, and Secret) are required.');
      return;
    }

    const portNum = Number(newPort.trim());
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setApiError('Port must be an integer between 1 and 65535.');
      return;
    }

    setIsSubmitting(true);
    setApiError('');
    setApiSuccess('');

    try {
      const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: newHost.trim(),
          port: portNum,
          secret: newSecret.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Failed to add proxy (${res.status})`);
      }

      setNewHost('');
      setNewPort('443');
      setNewSecret('');
      setApiSuccess(`Proxy ${newHost}:${portNum} added successfully.`);
      await syncProxies();
    } catch (err: any) {
      setApiError(err?.message || 'Failed to add new proxy');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger delete confirmation prompt
  const promptDeleteProxy = (proxy: ProxyRecord) => {
    setApiError('');
    setApiSuccess('');
    setProxyToDelete(proxy);
  };

  // Execute confirmed deletion
  const handleConfirmDelete = async () => {
    if (!proxyToDelete) return;
    setIsDeleting(true);
    setApiError('');
    setApiSuccess('');

    try {
      const res = await fetch(`${MTPROXY_BRIDGE_HTTP}/api/proxies/${encodeURIComponent(proxyToDelete.id)}`, {
        method: 'DELETE',
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Failed to delete proxy (${res.status})`);
      }

      setApiSuccess(`Proxy ${proxyToDelete.host}:${proxyToDelete.port} deleted successfully.`);
      setProxyToDelete(undefined);
      await syncProxies();
    } catch (err: any) {
      setApiError(err?.message || 'Could not delete proxy');
      setProxyToDelete(undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) {
    return undefined;
  }

  const activeProxy = proxies.find((p) => p.id === activeId) || proxies[0];

  const maskSecret = (secret: string) => {
    if (!secret || secret.length <= 10) return secret;
    return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
  };

  const getLatencyClass = (proxy: ProxyRecord) => {
    if (!proxy.isOnline || typeof proxy.latencyMs !== 'number') return styles.badgeOffline;
    if (proxy.latencyMs < 300) return styles.badgeLatency;
    return styles.badgeLatency;
  };

  return (
    <>
      <div className={styles.modalBackdrop} onClick={onClose}>
        <div
          className={styles.modalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="proxy-modal-title"
        >
          {/* Header */}
          <div className={styles.modalHeader}>
            <h2 id="proxy-modal-title">LizardTalk MTProxy Manager</h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className={styles.modalBody}>
            {/* Visible Error Banner */}
            {apiError && (
              <div className={styles.errorAlert} role="alert">
                <span>⚠️</span>
                <span>{apiError}</span>
              </div>
            )}

            {/* Visible Success Banner */}
            {apiSuccess && (
              <div className={styles.successAlert} role="status">
                <span>✓</span>
                <span>{apiSuccess}</span>
              </div>
            )}

            {/* Active Proxy Banner */}
            {activeProxy && (
              <div className={styles.activeBanner}>
                <div className={styles.activeBannerInfo}>
                  <div className={styles.activeBannerTitle}>Active MTProto Proxy</div>
                  <div className={styles.activeBannerEndpoint}>
                    <span
                      className={`${styles.statusDot} ${
                        activeProxy.isOnline
                          ? (activeProxy.latencyMs || 0) < 300
                            ? styles.dotGreen
                            : styles.dotYellow
                          : styles.dotRed
                      }`}
                    />
                    <span>{`${activeProxy.host}:${activeProxy.port}`}</span>
                  </div>
                  <div className={styles.activeBannerMeta}>
                    <span>
                      Secret:
                      {maskSecret(activeProxy.secret)}
                    </span>
                    <span>
                      Status:
                      {activeProxy.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>

                <div className={styles.activeBannerLatency}>
                  <span className={getLatencyClass(activeProxy)}>
                    {activeProxy.isOnline && typeof activeProxy.latencyMs === 'number'
                      ? `${activeProxy.latencyMs}ms`
                      : 'Offline'}
                  </span>
                </div>
              </div>
            )}

            {/* Proxy Pool Table */}
            <div>
              <h3 className={styles.sectionTitle}>Configured Proxy Pool</h3>
              <div className={styles.tableWrapper}>
                <table className={styles.proxyTable}>
                  <thead>
                    <tr>
                      <th>Host</th>
                      <th>Port</th>
                      <th>Secret</th>
                      <th>Latency</th>
                      <th>Last Checked</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxies.map((proxy) => {
                      const isCurrent = proxy.id === activeId;
                      return (
                        <tr key={proxy.id}>
                          <td><strong>{proxy.host}</strong></td>
                          <td>{proxy.port}</td>
                          <td className={styles.secretCell} title={proxy.secret}>
                            {maskSecret(proxy.secret)}
                          </td>
                          <td>
                            <span className={getLatencyClass(proxy)}>
                              {proxy.isOnline && typeof proxy.latencyMs === 'number'
                                ? `${proxy.latencyMs}ms`
                                : 'Offline'}
                            </span>
                          </td>
                          <td className={styles.timestampCell}>
                            <div className="flex flex-col">
                              <span className={`${styles.dateTop} date-top`}>
                                {formatDateGmt8(proxy.lastChecked)}
                              </span>
                              <span className={`${styles.timeBottom} time-bottom text-xs opacity-60`}>
                                {formatTimeGmt8(proxy.lastChecked)}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.actionButtonGroup}>
                              {isCurrent ? (
                                <span className={styles.badgeActive}>Active</span>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.btnAction} ${styles.btnSetActive}`}
                                  onClick={() => handleSetActive(proxy.id)}
                                  disabled={isLoading}
                                >
                                  Set Active
                                </button>
                              )}

                              {!proxy.isDefault && (
                                <button
                                  type="button"
                                  className={`${styles.btnAction} ${styles.btnDelete}`}
                                  onClick={() => promptDeleteProxy(proxy)}
                                  disabled={isLoading || isDeleting}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add New Proxy Form */}
            <div>
              <h3 className={styles.sectionTitle}>Add New MTProto Proxy</h3>
              <form className={styles.addForm} onSubmit={handleAddProxy}>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroup}>
                    <label htmlFor="proxy-host">Host</label>
                    <input
                      id="proxy-host"
                      type="text"
                      className={styles.inputField}
                      placeholder="e.g. 54.255.212.228"
                      value={newHost}
                      onChange={(e) => setNewHost((e.target).value)}
                      required
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label htmlFor="proxy-port">Port</label>
                    <input
                      id="proxy-port"
                      type="number"
                      className={styles.inputField}
                      placeholder="443"
                      min="1"
                      max="65535"
                      value={newPort}
                      onChange={(e) => setNewPort((e.target).value)}
                      required
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label htmlFor="proxy-secret">Secret</label>
                    <input
                      id="proxy-secret"
                      type="text"
                      className={styles.inputField}
                      placeholder="Hex, dd-, or ee-prefixed secret"
                      value={newSecret}
                      onChange={(e) => setNewSecret((e.target).value)}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className={styles.btnAddProxy}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Proxy'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Explicit Delete Confirmation Dialog */}
      <MtProxyConfirmModal
        isOpen={Boolean(proxyToDelete)}
        proxy={proxyToDelete}
        onConfirm={handleConfirmDelete}
        onCancel={() => setProxyToDelete(undefined)}
        isLoading={isDeleting}
      />
    </>
  );
};

export default MtProxyManagerModal;
