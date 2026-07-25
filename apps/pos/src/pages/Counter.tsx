import { useCallback, useEffect, useState } from 'react';
import {
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  COLLAR_OPTIONS,
  CUFF_OPTIONS,
  MEASUREMENT_POINTS,
  POCKET_OPTIONS,
  STITCHING_OPTIONS,
  api,
  errMsg,
  type MeasurementKey,
} from '../api';
import MeasurementDiagram from '../components/MeasurementDiagram';

interface Roll {
  id: string;
  batchCode: string;
  fabricName: string;
  brand: string | null;
  origin: string | null;
  color: string | null;
  colorShadeCode: string | null;
  available: string;
  remainderAfter: string;
  minUsable: string;
}

interface Garment {
  key: string;
  garmentType: string;
  fabricBatchId?: string;
  collarStyle?: string;
  cuffStyle?: string;
  pocketStyle?: string;
  stitchingStyle?: string;
  unitPrice: number;
}

const GARMENT_TYPES = ['Thobe', 'Bisht', 'Shirt', 'Trousers'];
const newGarment = (n: number): Garment => ({
  key: `g${n}-${Date.now()}`,
  garmentType: 'Thobe',
  unitPrice: 400,
  collarStyle: 'qallabi_2_button',
  cuffStyle: 'formal_kabak',
  pocketStyle: 'upper_left_patch',
  stitchingStyle: 'hidden_plain',
});

export default function Counter() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('+966');
  const [lookup, setLookup] = useState<Record<string, any> | null>(null);
  const [searching, setSearching] = useState(false);

  const [measurements, setMeasurements] = useState<Partial<Record<MeasurementKey, number | null>>>({});
  const [savingM, setSavingM] = useState(false);

  const [garments, setGarments] = useState<Garment[]>([newGarment(1)]);
  const [activeTab, setActiveTab] = useState('0');
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [yieldPer, setYieldPer] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const customer = lookup?.found ? lookup.customer : null;
  const activeThobeProfile = lookup?.activeMeasurements?.find(
    (m: Record<string, unknown>) => m.garmentType === 'Thobe',
  );

  const search = async () => {
    setSearching(true);
    setLookup(null);
    try {
      const { data } = await api.get('/pos/lookup', { params: { phone } });
      setLookup(data);
      if (data.found) {
        const active = data.activeMeasurements?.find(
          (m: Record<string, unknown>) => m.garmentType === 'Thobe',
        );
        if (active) {
          const next: Partial<Record<MeasurementKey, number | null>> = {};
          for (const p of MEASUREMENT_POINTS) {
            const v = active[p.key];
            next[p.key] = v == null ? null : Number(v);
          }
          setMeasurements(next);
        } else {
          setMeasurements({});
        }
      }
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSearching(false);
    }
  };

  const saveMeasurements = async () => {
    if (!customer) return;
    setSavingM(true);
    try {
      const { data } = await api.post(`/customers/${customer.id}/measurements`, {
        garmentType: 'Thobe',
        ...measurements,
      });
      message.success(`Measurement profile v${data.version} saved`);
      await search();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSavingM(false);
    }
  };

  /** Live yield + sellable rolls whenever measurements or garment count change. */
  const refreshStock = useCallback(async () => {
    if (!customer || !activeThobeProfile) return;
    try {
      const { data: y } = await api.get(`/pos/customers/${customer.id}/yield`, {
        params: { garmentType: 'Thobe', quantity: garments.length },
      });
      setYieldPer(Number(y.perGarment));
      const { data: r } = await api.get('/inventory/sellable', {
        params: { requiredMeters: y.perGarment },
      });
      setRolls(r);
    } catch (e) {
      setYieldPer(null);
      setRolls([]);
      // A missing M1/M3 is expected before measurements are taken — not an error toast.
      if (!String(errMsg(e)).includes('measurement')) message.error(errMsg(e));
    }
  }, [customer, activeThobeProfile, garments.length]);

  useEffect(() => {
    void refreshStock();
  }, [refreshStock]);

  const update = (index: number, patch: Partial<Garment>) =>
    setGarments((g) => g.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const total = garments.reduce((sum, g) => sum + (g.unitPrice || 0), 0);
  const totalYield = yieldPer ? (yieldPer * garments.length).toFixed(2) : null;
  const readyToCheckout =
    customer && garments.length > 0 && garments.every((g) => g.fabricBatchId) && yieldPer;

  const checkout = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.post('/pos/orders', {
        customerId: customer.id,
        depositAmount: deposit || undefined,
        depositMethod: 'card',
        items: garments.map((g) => ({
          garmentType: g.garmentType,
          fabricBatchId: g.fabricBatchId,
          collarStyle: g.collarStyle,
          cuffStyle: g.cuffStyle,
          pocketStyle: g.pocketStyle,
          stitchingStyle: g.stitchingStyle,
          unitPrice: g.unitPrice,
        })),
      });
      navigate(`/receipt/${data.id}`, { state: data });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      {/* Phase 1: profile initialisation by phone */}
      <Card size="small" style={{ marginBlockEnd: 16 }}>
        <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
          <Input
            size="large"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onPressEnter={search}
            placeholder="+9665xxxxxxxx"
            inputMode="tel"
            style={{ fontSize: 20 }}
          />
          <Button size="large" type="primary" icon={<SearchOutlined />} onClick={search} loading={searching}>
            Find
          </Button>
        </Space.Compact>

        {lookup && !lookup.found && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBlockStart: 12 }}
            message={`No customer with ${lookup.phone}`}
            description="Create the customer in the admin app, then search again."
          />
        )}

        {customer && (
          <Space size="large" style={{ marginBlockStart: 12 }} wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {customer.fullName}
            </Typography.Title>
            <Tag color="gold">{String(customer.tier).toUpperCase()}</Tag>
            <Typography.Text type="secondary">
              {customer.lifetimeOrderCount} garments to date
            </Typography.Text>
            {customer.whatsappConsent && <Tag color="green">WhatsApp opted in</Tag>}
          </Space>
        )}
      </Card>

      {customer && (
        <Row gutter={16}>
          {/* Phase 1 §2: measurement verification on the 2D blueprint */}
          <Col xs={24} xl={11}>
            <Card
              title="Measurements (cm)"
              size="small"
              extra={
                activeThobeProfile ? (
                  <Tag color="blue">active v{activeThobeProfile.version}</Tag>
                ) : (
                  <Tag color="red">none on file</Tag>
                )
              }
              style={{ marginBlockEnd: 16 }}
            >
              <MeasurementDiagram
                values={measurements}
                onChange={(k, v) => setMeasurements((m) => ({ ...m, [k]: v }))}
              />
              <Button
                type="primary"
                size="large"
                block
                style={{ marginBlockStart: 16 }}
                loading={savingM}
                onClick={saveMeasurements}
                disabled={!measurements.m1TotalLength || !measurements.m3SleeveLength}
              >
                Save as new version
              </Button>
              {(!measurements.m1TotalLength || !measurements.m3SleeveLength) && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  M1 and M3 are required — the fabric yield is calculated from them.
                </Typography.Text>
              )}
            </Card>
          </Col>

          {/* Phase 1 §3 + Phase 2: garment tabs and live stock validation */}
          <Col xs={24} xl={13}>
            <Card
              title="Garments"
              size="small"
              extra={
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setGarments((g) => [...g, newGarment(g.length + 1)]);
                    setActiveTab(String(garments.length));
                  }}
                >
                  Add garment
                </Button>
              }
            >
              {!activeThobeProfile ? (
                <Empty description="Save a measurement profile first" />
              ) : (
                <>
                  <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={garments.map((g, i) => ({
                      key: String(i),
                      label: `${g.garmentType} ${i + 1}`,
                      children: (
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                          <Row gutter={12}>
                            <Col span={12}>
                              <div style={{ fontSize: 13, color: '#757575' }}>Type</div>
                              <Select
                                size="large"
                                style={{ width: '100%' }}
                                value={g.garmentType}
                                onChange={(v) => update(i, { garmentType: v })}
                                options={GARMENT_TYPES.map((t) => ({ value: t }))}
                              />
                            </Col>
                            <Col span={12}>
                              <div style={{ fontSize: 13, color: '#757575' }}>Price (SAR, incl. VAT)</div>
                              <InputNumber
                                size="large"
                                style={{ width: '100%' }}
                                min={0}
                                value={g.unitPrice}
                                onChange={(v) => update(i, { unitPrice: v ?? 0 })}
                              />
                            </Col>
                          </Row>

                          <div>
                            <div style={{ fontSize: 13, color: '#757575' }}>Collar</div>
                            <Segmented
                              size="large"
                              block
                              value={g.collarStyle}
                              onChange={(v) => update(i, { collarStyle: String(v) })}
                              options={COLLAR_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 13, color: '#757575' }}>Cuff</div>
                            <Segmented
                              size="large"
                              block
                              value={g.cuffStyle}
                              onChange={(v) => update(i, { cuffStyle: String(v) })}
                              options={CUFF_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
                            />
                          </div>
                          <Row gutter={12}>
                            <Col span={12}>
                              <div style={{ fontSize: 13, color: '#757575' }}>Pocket</div>
                              <Select
                                size="large"
                                style={{ width: '100%' }}
                                value={g.pocketStyle}
                                onChange={(v) => update(i, { pocketStyle: v })}
                                options={POCKET_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
                              />
                            </Col>
                            <Col span={12}>
                              <div style={{ fontSize: 13, color: '#757575' }}>Stitching</div>
                              <Select
                                size="large"
                                style={{ width: '100%' }}
                                value={g.stitchingStyle}
                                onChange={(v) => update(i, { stitchingStyle: v })}
                                options={STITCHING_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
                              />
                            </Col>
                          </Row>

                          <div>
                            <div style={{ fontSize: 13, color: '#757575' }}>
                              Fabric roll{' '}
                              {yieldPer && <Tag color="blue">needs {yieldPer.toFixed(2)}m</Tag>}
                            </div>
                            <Select
                              size="large"
                              style={{ width: '100%' }}
                              placeholder={rolls.length ? 'Select a roll' : 'No roll can supply this yield'}
                              value={g.fabricBatchId}
                              onChange={(v) => update(i, { fabricBatchId: v })}
                              options={rolls.map((r) => ({
                                value: r.id,
                                label: `${r.fabricName} · ${r.batchCode}${r.origin ? ` · ${r.origin}` : ''} — ${r.available}m avail, ${r.remainderAfter}m after`,
                              }))}
                              notFoundContent={
                                <Typography.Text type="danger">
                                  Every roll would drop below its {rolls[0]?.minUsable ?? '3.50'}m minimum
                                </Typography.Text>
                              }
                            />
                          </div>

                          {garments.length > 1 && (
                            <Button
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                setGarments((gs) => gs.filter((_, idx) => idx !== i));
                                setActiveTab('0');
                              }}
                            >
                              Remove this garment
                            </Button>
                          )}
                        </Space>
                      ),
                    }))}
                  />

                  <Divider style={{ margin: '12px 0' }} />

                  <Row gutter={16} align="middle">
                    <Col xs={12} md={6}>
                      <Statistic title="Garments" value={garments.length} />
                    </Col>
                    <Col xs={12} md={6}>
                      <Statistic
                        title="Fabric needed"
                        value={totalYield ?? '—'}
                        suffix={totalYield ? 'm' : ''}
                      />
                    </Col>
                    <Col xs={12} md={6}>
                      <Statistic title="Total (incl. VAT)" value={total.toFixed(2)} prefix="SAR" />
                    </Col>
                    <Col xs={12} md={6}>
                      <div style={{ fontSize: 13, color: '#757575' }}>Deposit</div>
                      <Space.Compact style={{ width: '100%' }}>
                        <InputNumber
                          size="large"
                          min={0}
                          max={total}
                          value={deposit}
                          onChange={(v) => setDeposit(v ?? 0)}
                          style={{ width: '100%' }}
                        />
                        <Button size="large" onClick={() => setDeposit(Number((total / 2).toFixed(2)))}>
                          50%
                        </Button>
                      </Space.Compact>
                    </Col>
                  </Row>

                  <Button
                    type="primary"
                    size="large"
                    block
                    icon={<ShoppingCartOutlined />}
                    style={{ marginBlockStart: 16, height: 56, fontSize: 18 }}
                    disabled={!readyToCheckout}
                    loading={submitting}
                    onClick={checkout}
                  >
                    Checkout · SAR {total.toFixed(2)}
                    {deposit > 0 && ` · deposit ${deposit.toFixed(2)}`}
                  </Button>
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {searching && !lookup && <Spin style={{ display: 'block', marginBlockStart: 40 }} />}
    </div>
  );
}
