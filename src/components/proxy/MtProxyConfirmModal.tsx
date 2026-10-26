import type { FC } from '../../lib/teact/teact';
import React from '../../lib/teact/teact';

import type { ProxyRecord } from './types';

import styles from './MtProxy.module.scss';

export interface MtProxyConfirmModalProps {
  isOpen: boolean;
  proxy: ProxyRecord | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const MtProxyConfirmModal: FC<MtProxyConfirmModalProps> = ({
  isOpen,
  proxy,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  if (!isOpen || !proxy) {
    return undefined;
  }

  return (
    <div className={styles.confirmModalBackdrop} onClick={onCancel}>
      <div
        className={styles.confirmModalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h3 id="confirm-modal-title" className={styles.confirmTitle}>
          Confirm Proxy Deletion
        </h3>

        <p className={styles.confirmMessage}>
          {`Are you sure you want to delete proxy "${proxy.host}:${proxy.port}"? This action cannot be undone.`}
        </p>

        <div className={styles.confirmProxyDetail}>
          <div>
            <strong>Host:</strong>
            {' '}
            {proxy.host}
          </div>
          <div>
            <strong>Port:</strong>
            {' '}
            {proxy.port}
          </div>
        </div>

        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.btnCancel}
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnConfirmDelete}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Deleting...' : 'Confirm Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MtProxyConfirmModal;
