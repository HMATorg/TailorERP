import { useEffect, useState } from 'react';
import { Collapse, Descriptions, Drawer, Empty, Skeleton, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { garmentFamily, type GarmentMeasurementHistory, type MeasurementSnapshot } from '@tailonix/shared';
import { api, errMsg } from '../api/client';

interface CustomerDetail {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  language: string;
  whatsappConsent: boolean;
  lifetimeOrderCount: number;
  notes: string | null;
  createdAt: string;
  visits: { store: { id: string; name: string }; lastVisitDate: string }[];
  orders: {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: string;
    paidAmount: string;
    createdAt: string;
    store: { name: string };
  }[];
  _count: { orders: number; appointments: number };
}

/**
 * M1–M13, mirroring the labels the counter and workshop already use. Robe
 * family: Thobe/Bisht/Shirt. M9-M13 added D-055 against a real tailor shop's
 * own paper order form.
 */
const MEASUREMENT_POINTS = [
  { key: 'm1TotalLength', label: 'M1 · Total Length' },
  { key: 'm2ShoulderWidth', label: 'M2 · Shoulder' },
  { key: 'm3SleeveLength', label: 'M3 · Sleeve' },
  { key: 'm4ChestCirc', label: 'M4 · Chest' },
  { key: 'm5HipWidth', label: 'M5 · Hip' },
  { key: 'm6NeckDiameter', label: 'M6 · Neck' },
  { key: 'm7WristOpening', label: 'M7 · Wrist' },
  { key: 'm8SkirtPerimeter', label: 'M8 · Hem' },
  { key: 'm9Waist', label: 'M9 · Waist' },
  { key: 'm10RoundShoulder', label: 'M10 · Round Shoulder' },
  { key: 'm11MidHand', label: 'M11 · Mid of Hand' },
  { key: 'm12PlateLength', label: 'M12 · Plate Length' },
  { key: 'm13HalfChest', label: 'M13 · Half Chest' },
] as const;

/** T1–T7 — Trousers' own points (D-054). Not a robe: no sleeve, neck or hem. */
const TROUSER_MEASUREMENT_POINTS = [
  { key: 't1Waist', label: 'T1 · Waist' },
  { key: 't2Hip', label: 'T2 · Hip' },
  { key: 't3Inseam', label: 'T3 · Inseam' },
  { key: 't4Outseam', label: 'T4 · Outseam' },
  { key: 't5Thigh', label: 'T5 · Thigh' },
  { key: 't6Knee', label: 'T6 · Knee' },
  { key: 't7AnkleOpening', label: 'T7 · Ankle' },
] as const;

function pointsForGarmentType(garmentType: string) {
  return garmentFamily(garmentType) === 'trousers' ? TROUSER_MEASUREMENT_POINTS : MEASUREMENT_POINTS;
}

/**
 * Full customer record for HQ oversight (v4 §1 amendment).
 *
 * `GET /customers/:id` and `GET /customers/:id/measurements/history` already
 * existed and returned everything shown here — the customer's whole
 * measurement history (every version, not just the active snapshot), which
 * store(s) they've visited, and recent orders. The admin app simply never
 * had a UI to reach them (D-046). Read-only: editing a walk-in's own record
 * belongs to whoever registered them, at the counter, not to this drawer.
 */
export default function CustomerDetailDrawer({
  customerId,
  onClose,
}: {
  customerId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [history, setHistory] = useState<GarmentMeasurementHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/customers/${customerId}`),
      api.get(`/customers/${customerId}/measurements/history`),
    ])
      .then(([d, h]) => {
        setDetail(d.data);
        setHistory(h.data);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [customerId]);

  return (
    <Drawer
      open={!!customerId}
      onClose={onClose}
      width={560}
      title={detail?.fullName ?? 'Customer record'}
      destroyOnHidden
    >
      {loading && <Skeleton active />}
      {error && <Typography.Text type="danger">{error}</Typography.Text>}

      {detail && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Phone">{detail.phone}</Descriptions.Item>
            <Descriptions.Item label="Email">{detail.email ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Language">{detail.language}</Descriptions.Item>
            <Descriptions.Item label="WhatsApp">
              {detail.whatsappConsent ? <Tag color="green">opted in</Tag> : <Tag>—</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Lifetime garments">{detail.lifetimeOrderCount}</Descriptions.Item>
            <Descriptions.Item label="Customer since">
              {new Date(detail.createdAt).toLocaleDateString()}
            </Descriptions.Item>
            {detail.notes && <Descriptions.Item label="Notes">{detail.notes}</Descriptions.Item>}
          </Descriptions>

          <Typography.Title level={5} style={{ marginBlockStart: 24 }}>
            Stores visited
          </Typography.Title>
          {detail.visits.length === 0 ? (
            <Typography.Text type="secondary">No recorded visits yet.</Typography.Text>
          ) : (
            <Table
              size="small"
              pagination={false}
              rowKey={(v) => v.store.id}
              dataSource={detail.visits}
              columns={[
                { title: 'Store', render: (_, v) => v.store.name },
                {
                  title: 'Last visit',
                  render: (_, v) => new Date(v.lastVisitDate).toLocaleDateString(),
                },
              ]}
            />
          )}

          <Typography.Title level={5} style={{ marginBlockStart: 24 }}>
            Recent orders ({detail._count.orders} total)
          </Typography.Title>
          {detail.orders.length === 0 ? (
            <Typography.Text type="secondary">No orders yet.</Typography.Text>
          ) : (
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={detail.orders}
              columns={[
                {
                  title: 'Order',
                  render: (_, o) => <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>,
                },
                { title: 'Store', render: (_, o) => o.store.name },
                { title: 'Status', dataIndex: 'status', render: (v) => <Tag>{v}</Tag> },
                { title: 'Total', render: (_, o) => `SAR ${o.totalAmount}` },
                { title: 'Paid', render: (_, o) => `SAR ${o.paidAmount}` },
                {
                  title: 'Date',
                  render: (_, o) => new Date(o.createdAt).toLocaleDateString(),
                },
              ]}
            />
          )}

          <Typography.Title level={5} style={{ marginBlockStart: 24 }}>
            Measurement history
          </Typography.Title>
          {history.length === 0 ? (
            <Empty description="No measurements taken yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Collapse
              defaultActiveKey={history.map((h) => h.garmentType)}
              items={history.map((garment) => ({
                key: garment.garmentType,
                label: (
                  <span>
                    {garment.garmentType}{' '}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {garment.versions.length} version{garment.versions.length === 1 ? '' : 's'}
                      {garment.activeVersion == null && ' · none active'}
                    </Typography.Text>
                  </span>
                ),
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="id"
                    dataSource={garment.versions}
                    columns={[
                      {
                        title: 'Version',
                        render: (_, v) => (
                          <span>
                            v{v.version} {v.isActive && <Tag color="green">active</Tag>}
                          </span>
                        ),
                      },
                      ...pointsForGarmentType(garment.garmentType).map((p) => ({
                        title: p.label,
                        render: (_: unknown, v: MeasurementSnapshot) => v[p.key] ?? '—',
                      })),
                      {
                        title: 'Taken',
                        render: (_: unknown, v: MeasurementSnapshot) =>
                          new Date(v.createdAt).toLocaleDateString(),
                      },
                    ]}
                  />
                ),
              }))}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
