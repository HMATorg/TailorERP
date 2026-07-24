import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, InputNumber, Modal, Table, Typography, message } from 'antd';
import { Trans, useTranslation } from 'react-i18next';
import { api, errMsg } from '../api/client';

export interface BatchRow {
  id: string;
  batchCode: string;
  color: string | null;
  currentQuantity: string;
  storageLocation: string | null;
  purchaseDate: string;
  unit: string;
}

export interface BatchAllocation {
  batchId: string;
  batchCode: string;
  quantity: number;
}

interface Props {
  open: boolean;
  fabricName: string;
  requiredQty: number;
  initial?: BatchAllocation[];
  onCancel: () => void;
  onConfirm: (allocations: BatchAllocation[]) => void;
}

/**
 * Wireframes §3.3: batches listed oldest-first (FIFO) with per-batch quantity
 * inputs; confirm is enabled once the selected total covers the requirement.
 */
export default function BatchSelectorModal({
  open,
  fabricName,
  requiredQty,
  initial,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !fabricName) return;
    setLoading(true);
    api
      .get('/inventory/batches', { params: { fabricName, status: 'available', pageSize: 100 } })
      .then(({ data }) => {
        const sorted = [...data.items].sort(
          (a: BatchRow, b: BatchRow) =>
            new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime(),
        );
        setBatches(sorted);
        setQty(Object.fromEntries((initial ?? []).map((a) => [a.batchId, a.quantity])));
      })
      .catch((e) => message.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, [open, fabricName, initial]);

  const totalAvailable = useMemo(
    () => batches.reduce((sum, b) => sum + Number(b.currentQuantity), 0),
    [batches],
  );
  const selectedTotal = useMemo(
    () => Object.values(qty).reduce((sum, v) => sum + (v || 0), 0),
    [qty],
  );
  const insufficientStock = totalAvailable < requiredQty;
  const visible = batches.filter((b) =>
    b.batchCode.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Modal
      open={open}
      title={`${t('inventory.selectBatch')} — ${fabricName}`}
      onCancel={onCancel}
      okText={t('inventory.addToOrder')}
      okButtonProps={{ disabled: selectedTotal !== requiredQty || insufficientStock }}
      onOk={() =>
        onConfirm(
          batches
            .filter((b) => (qty[b.id] ?? 0) > 0)
            .map((b) => ({ batchId: b.id, batchCode: b.batchCode, quantity: qty[b.id] })),
        )
      }
      width={640}
    >
      {insufficientStock && (
        <Alert
          type="error"
          message={t('inventory.insufficientStock', { available: totalAvailable })}
          style={{ marginBlockEnd: 12 }}
        />
      )}
      <Input.Search
        placeholder={t('inventory.filterByBatchCode')}
        allowClear
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBlockEnd: 12 }}
      />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={visible}
        pagination={false}
        scroll={{ y: 280 }}
        columns={[
          { title: t('inventory.batchCode'), dataIndex: 'batchCode' },
          { title: t('inventory.color'), dataIndex: 'color', render: (v) => v ?? '—' },
          {
            title: t('inventory.available'),
            dataIndex: 'currentQuantity',
            render: (v: string, r) => `${v} ${r.unit}`,
          },
          { title: t('inventory.location'), dataIndex: 'storageLocation', render: (v) => v ?? '—' },
          {
            title: t('inventory.useQty'),
            width: 120,
            render: (_, r) => (
              <InputNumber
                min={0}
                max={Number(r.currentQuantity)}
                step={0.5}
                value={qty[r.id] ?? 0}
                onChange={(v) => setQty((q) => ({ ...q, [r.id]: v ?? 0 }))}
              />
            ),
          },
        ]}
      />
      <Typography.Paragraph style={{ marginBlockStart: 12, textAlign: 'end' }}>
        <Trans
          i18nKey="inventory.youNeed"
          values={{ required: requiredQty, selected: selectedTotal }}
          components={{ 1: <b />, 3: <b /> }}
        />
      </Typography.Paragraph>
    </Modal>
  );
}
