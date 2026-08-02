import { useCallback, useEffect, useRef, useState } from 'react';
import { BarcodeOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Modal,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TicketMeasurements } from '@tailonix/shared';
import { api, errMsg } from '../api';

interface Ticket {
  id: string;
  ticketCode: string;
  station: string;
  assignedTo: { id: string; fullName: string | null } | null;
  order: {
    orderNumber: string;
    dueDate: string | null;
    customer: { fullName: string; phone: string };
  };
  orderItem: {
    garmentType: string;
    sequenceNo: number;
    collarStyle: string | null;
    cuffStyle: string | null;
    pocketStyle: string | null;
    stitchingStyle: string | null;
    yieldMeters: string | null;
  };
}

interface Column {
  station: string;
  label: { en: string; ar: string };
  tickets: Ticket[];
}

const NEXT: Record<string, string> = {
  queued: 'cutting',
  cutting: 'stitching',
  stitching: 'quality',
  quality: 'ready',
};

const COLUMN_TINT: Record<string, string> = {
  queued: '#F5F5F5',
  cutting: '#FFF8E1',
  stitching: '#E3F2FD',
  quality: '#F3E5F5',
};

const pretty = (v: string | null) => (v ? v.replace(/_/g, ' ') : '—');

/**
 * Workshop Kanban on a shop-floor tablet (v4 Phase 4). The barcode field holds
 * focus permanently — scanners type and press Enter, so anything else would
 * make the hardware silently fail.
 */
export default function Workshop() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState<Record<string, any> | null>(null);
  // Measurements come from their own endpoint so the floor sees the snapshot the
  // garment was CUT AGAINST plus its history — not whatever is active now.
  const [measure, setMeasure] = useState<TicketMeasurements | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [code, setCode] = useState('');
  const scanRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workshop/board');
      setColumns(data.columns);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // The floor changes without this tablet's involvement, so poll.
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const scan = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const { data } = await api.get(`/workshop/tickets/by-code/${encodeURIComponent(trimmed)}`);
      setShowHistory(false);
      setMeasure(null);
      api
        .get(`/workshop/tickets/${data.id}/measurements`)
        .then((r) => setMeasure(r.data))
        .catch(() => setMeasure(null));
      setScanned(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setCode('');
      scanRef.current?.focus();
    }
  };

  const move = async (ticket: { id: string; station: string; ticketCode: string }) => {
    const toStation = NEXT[ticket.station];
    if (!toStation) return;
    try {
      await api.put(`/workshop/tickets/${ticket.id}/station`, { toStation });
      message.success(
        toStation === 'stitching'
          ? `${ticket.ticketCode} cut — fabric deducted from the roll`
          : `${ticket.ticketCode} → ${toStation}`,
      );
      setScanned(null);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBlockEnd: 16 }} wrap>
        <Input
          ref={scanRef}
          autoFocus
          size="large"
          prefix={<BarcodeOutlined />}
          placeholder="Scan a ticket barcode…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={(e) => void scan((e.target as HTMLInputElement).value)}
          style={{ width: 380, fontSize: 18 }}
        />
        <Button size="large" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </Space>

      <Row gutter={12}>
        {columns.map((col) => (
          <Col key={col.station} xs={24} sm={12} lg={6}>
            <Card
              size="small"
              style={{ background: COLUMN_TINT[col.station], minHeight: 400 }}
              title={
                <Space>
                  <span>{col.label.en}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {col.label.ar}
                  </Typography.Text>
                  <Badge count={col.tickets.length} showZero color="#00695C" />
                </Space>
              }
            >
              {col.tickets.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Empty" />}
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {col.tickets.map((t) => (
                  <Card
                    key={t.id}
                    size="small"
                    hoverable
                    styles={{ body: { padding: 10 } }}
                    onClick={() => void scan(t.ticketCode)}
                  >
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Typography.Text strong style={{ fontSize: 15 }}>
                          {t.ticketCode}
                        </Typography.Text>
                        <Tag>{t.orderItem.garmentType}</Tag>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t.order.customer.fullName}
                      </Typography.Text>
                      <Space wrap size={4}>
                        <Tag color="cyan" style={{ fontSize: 11 }}>
                          {pretty(t.orderItem.collarStyle)}
                        </Tag>
                        <Tag color="blue" style={{ fontSize: 11 }}>
                          {pretty(t.orderItem.cuffStyle)}
                        </Tag>
                      </Space>
                      {t.orderItem.yieldMeters && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {t.orderItem.yieldMeters}m fabric
                        </Typography.Text>
                      )}
                      {NEXT[t.station] && (
                        <Button
                          type="primary"
                          size="small"
                          block
                          style={{ marginBlockStart: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void move(t);
                          }}
                        >
                          → {NEXT[t.station]}
                        </Button>
                      )}
                    </Space>
                  </Card>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        open={!!scanned}
        title={scanned ? `Ticket ${scanned.ticketCode}` : ''}
        onCancel={() => {
          setScanned(null);
          setMeasure(null);
        }}
        footer={null}
        width={720}
      >
        {scanned && (
          <>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
              <Descriptions.Item label="Order">{scanned.order.orderNumber}</Descriptions.Item>
              <Descriptions.Item label="Customer">{scanned.order.customer.fullName}</Descriptions.Item>
              <Descriptions.Item label="Garment">{scanned.orderItem.garmentType}</Descriptions.Item>
              <Descriptions.Item label="Station">
                <Tag color="blue">{scanned.stationLabel?.en}</Tag>
                {scanned.stationLabel?.ar}
              </Descriptions.Item>
              <Descriptions.Item label="Collar">{pretty(scanned.orderItem.collarStyle)}</Descriptions.Item>
              <Descriptions.Item label="Cuff">{pretty(scanned.orderItem.cuffStyle)}</Descriptions.Item>
              <Descriptions.Item label="Pocket">{pretty(scanned.orderItem.pocketStyle)}</Descriptions.Item>
              <Descriptions.Item label="Stitching">{pretty(scanned.orderItem.stitchingStyle)}</Descriptions.Item>
              <Descriptions.Item label="Fabric needed">{scanned.orderItem.yieldMeters}m</Descriptions.Item>
            </Descriptions>

            {measure?.cutAgainst && (
              <>
                {measure.supersededByNewerVersion && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBlockStart: 16 }}
                    message="This customer has been re-measured since this ticket was cut"
                    description={
                      'Keep working to version ' +
                      measure.cutAgainst.version +
                      ' below — it is what the fabric was cut to. The newer version applies to future orders.'
                    }
                  />
                )}
                <Descriptions
                  title={
                    <Space>
                      <span>Cutting to (cm)</span>
                      <Tag color={measure.supersededByNewerVersion ? 'orange' : 'green'}>
                        v{measure.cutAgainst.version}
                      </Tag>
                    </Space>
                  }
                  column={{ xs: 2, md: 4 }}
                  size="small"
                  style={{ marginBlockStart: 16 }}
                >
                  {measure.points.map((p) => (
                    <Descriptions.Item
                      key={p.key}
                      label={`${p.label} ${p.labelAr}`}
                    >
                      {measure.cutAgainst?.[p.key] ?? '—'}
                    </Descriptions.Item>
                  ))}
                </Descriptions>

                {measure.history.length > 1 && (
                  <>
                    <Button
                      size="small"
                      type="link"
                      style={{ paddingInline: 0 }}
                      onClick={() => setShowHistory((v) => !v)}
                    >
                      {showHistory
                        ? 'Hide measurement history'
                        : `Show measurement history (${measure.history.length} versions)`}
                    </Button>
                    {showHistory && (
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="id"
                        style={{ marginBlockStart: 8 }}
                        dataSource={measure.history}
                        columns={[
                          {
                            title: 'Ver',
                            dataIndex: 'version',
                            width: 76,
                            render: (v: number, row: any) => (
                              <Space size={4}>
                                <span>v{v}</span>
                                {row.isActive && <Tag color="green">current</Tag>}
                                {measure.cutAgainst?.version === v && <Tag color="blue">cut</Tag>}
                              </Space>
                            ),
                          },
                          ...measure.points.map((p) => ({
                            title: p.label,
                            dataIndex: p.key,
                            render: (v: string | null) => v ?? '—',
                          })),
                          {
                            title: 'Taken',
                            dataIndex: 'createdAt',
                            render: (v: string) => new Date(v).toLocaleDateString(),
                          },
                        ]}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {NEXT[scanned.station] && (
              <Button
                type="primary"
                size="large"
                block
                style={{ marginBlockStart: 16, height: 52 }}
                onClick={() => void move(scanned as { id: string; station: string; ticketCode: string })}
              >
                Complete {scanned.stationLabel?.en} → {NEXT[scanned.station]}
              </Button>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
