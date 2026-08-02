import { useCallback, useEffect, useState } from 'react';
import { CloseOutlined, DeleteOutlined, PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
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
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  COLLAR_OPTIONS,
  CUFF_OPTIONS,
  CUT_STYLE_OPTIONS,
  POCKET_OPTIONS,
  STITCHING_OPTIONS,
  api,
  errMsg,
  garmentFamily,
  measurementPointsFor,
  requiredMeasurementKeysFor,
  type MeasurementKey,
} from '../api';
import CustomerPicker from '../components/CustomerPicker';
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
  customerSuppliesFabric?: boolean;
  collarStyle?: string;
  cuffStyle?: string;
  pocketStyle?: string;
  stitchingStyle?: string;
  cutStyle?: string;
  cufflinkSize?: string;
  unitPrice: number;
}

const GARMENT_TYPES = ['Thobe', 'Bisht', 'Shirt', 'Trousers'];
const DEPOSIT_METHODS: { value: 'cash' | 'card' | 'transfer' | 'other'; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];
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
  const [lookup, setLookup] = useState<Record<string, any> | null>(null);
  const [searching, setSearching] = useState(false);

  const [measurements, setMeasurements] = useState<Partial<Record<MeasurementKey, number | null>>>({});
  // Trousers/shalwar palla widths (D-068) — a variable-count list, not a
  // fixed matrix point: how many pleats a shalwar has is a per-garment choice.
  const [pallas, setPallas] = useState<{ label: string; valueCm: number | null }[]>([]);
  const [savingM, setSavingM] = useState(false);

  const [garments, setGarments] = useState<Garment[]>([newGarment(1)]);
  const [activeTab, setActiveTab] = useState('0');
  // Yield and sellable rolls depend on garment type, not just quantity — a
  // Shirt and a Thobe need different fabric and can't share one global value
  // (D-051, fixing a bug where every garment was silently measured and cut
  // against the Thobe profile regardless of its own selected type).
  const [yieldByType, setYieldByType] = useState<Record<string, number | null>>({});
  const [rollsByType, setRollsByType] = useState<Record<string, Roll[]>>({});
  const [deposit, setDeposit] = useState<number>(0);
  const [depositMethod, setDepositMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('cash');
  const [discount, setDiscount] = useState<number>(0);
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const customer = lookup?.found ? lookup.customer : null;
  const activeGarmentType = garments[Number(activeTab)]?.garmentType ?? 'Thobe';
  const profileFor = (garmentType: string): Record<string, unknown> | undefined =>
    lookup?.activeMeasurements?.find((m: Record<string, unknown>) => m.garmentType === garmentType);
  const activeProfile = profileFor(activeGarmentType);
  const hasAnyProfile = (lookup?.activeMeasurements?.length ?? 0) > 0;

  /** Opens the full profile for a customer picked from the search list. */
  const openCustomer = async (customerId: string) => {
    setSearching(true);
    try {
      await loadProfile(customerId);
      // A fresh customer starts a fresh order — a half-filled garment left over
      // from whoever was at the counter a moment ago must not follow them in.
      setGarments([newGarment(1)]);
      setActiveTab('0');
      setDeposit(0);
      setDiscount(0);
      setDueDate(null);
      setNotes('');
      setIsUrgent(false);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSearching(false);
    }
  };

  /** Fetches and applies a customer's profile without touching the in-progress order. */
  const loadProfile = async (customerId: string) => {
    const { data } = await api.get(`/pos/customers/${customerId}`);
    setLookup(data);
  };

  const changeCustomer = () => {
    setLookup(null);
    setMeasurements({});
    setGarments([newGarment(1)]);
    setActiveTab('0');
    setDeposit(0);
    setDiscount(0);
    setDueDate(null);
    setNotes('');
    setIsUrgent(false);
  };

  // The Measurements panel always edits whichever garment tab is active —
  // switching tabs (or changing a tab's Type) reloads the form from that
  // type's saved profile instead of always showing Thobe's. Trousers has its
  // own point set entirely (T1-T7, no M1-M8 at all) — D-054.
  const activePoints = measurementPointsFor(activeGarmentType);
  useEffect(() => {
    const active = profileFor(activeGarmentType);
    const next: Partial<Record<MeasurementKey, number | null>> = {};
    for (const p of activePoints) {
      const v = active?.[p.key];
      next[p.key] = v == null ? null : Number(v);
    }
    setMeasurements(next);
    const savedPallas = active?.trouserPallas as { label: string; valueCm: number | string }[] | undefined;
    setPallas(
      Array.isArray(savedPallas)
        ? savedPallas.map((p) => ({ label: p.label, valueCm: p.valueCm == null ? null : Number(p.valueCm) }))
        : [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGarmentType, lookup]);

  const saveMeasurements = async () => {
    if (!customer) return;
    setSavingM(true);
    try {
      // Only send this family's own fields — a Trousers save must not carry
      // stale robe values (or vice versa) into the new row.
      const payload = Object.fromEntries(activePoints.map((p) => [p.key, measurements[p.key]]));
      const trouserPallas =
        garmentFamily(activeGarmentType) === 'trousers'
          ? pallas.filter((p) => p.label.trim() && p.valueCm != null)
          : undefined;
      const { data } = await api.post(`/customers/${customer.id}/measurements`, {
        garmentType: activeGarmentType,
        ...payload,
        ...(trouserPallas?.length ? { trouserPallas } : {}),
      });
      message.success(`${activeGarmentType} measurement profile v${data.version} saved`);
      await loadProfile(customer.id);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSavingM(false);
    }
  };

  const garmentTypeKey = garments.map((g) => g.garmentType).join('|');

  /** Live yield + sellable rolls per distinct garment type in the cart. */
  const refreshStock = useCallback(async () => {
    if (!customer) return;
    const countByType = garments.reduce<Record<string, number>>((acc, g) => {
      acc[g.garmentType] = (acc[g.garmentType] ?? 0) + 1;
      return acc;
    }, {});
    const nextYield: Record<string, number | null> = {};
    const nextRolls: Record<string, Roll[]> = {};
    await Promise.all(
      Object.keys(countByType).map(async (type) => {
        if (!profileFor(type)) {
          nextYield[type] = null;
          nextRolls[type] = [];
          return;
        }
        try {
          const { data: y } = await api.get(`/pos/customers/${customer.id}/yield`, {
            params: { garmentType: type, quantity: countByType[type] },
          });
          nextYield[type] = Number(y.perGarment);
          const { data: r } = await api.get('/inventory/sellable', {
            params: { requiredMeters: y.perGarment },
          });
          nextRolls[type] = r;
        } catch (e) {
          nextYield[type] = null;
          nextRolls[type] = [];
          if (!String(errMsg(e)).includes('measurement')) message.error(errMsg(e));
        }
      }),
    );
    setYieldByType(nextYield);
    setRollsByType(nextRolls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, garmentTypeKey, lookup]);

  useEffect(() => {
    void refreshStock();
  }, [refreshStock]);

  const update = (index: number, patch: Partial<Garment>) =>
    setGarments((g) => g.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const grossTotal = garments.reduce((sum, g) => sum + (g.unitPrice || 0), 0);
  const total = Math.max(0, grossTotal - discount);
  const totalYield = garments.every((g) => yieldByType[g.garmentType] != null)
    ? garments.reduce((sum, g) => sum + (yieldByType[g.garmentType] ?? 0), 0).toFixed(2)
    : null;
  const readyToCheckout =
    customer &&
    garments.length > 0 &&
    garments.every((g) => g.customerSuppliesFabric || g.fabricBatchId) &&
    garments.every((g) => yieldByType[g.garmentType] != null);

  const checkout = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.post('/pos/orders', {
        customerId: customer.id,
        depositAmount: deposit || undefined,
        depositMethod,
        discountAmount: discount || undefined,
        dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined,
        notes: notes || undefined,
        isUrgent: isUrgent || undefined,
        items: garments.map((g) => ({
          garmentType: g.garmentType,
          fabricBatchId: g.customerSuppliesFabric ? undefined : g.fabricBatchId,
          collarStyle: g.collarStyle,
          cuffStyle: g.cuffStyle,
          pocketStyle: g.pocketStyle,
          stitchingStyle: g.stitchingStyle,
          cutStyle: g.cutStyle,
          cufflinkSize: g.cufflinkSize || undefined,
          unitPrice: g.unitPrice,
        })),
      });
      // The checkout response carries totals but not a per-garment price
      // breakdown, so Receipt needs the submitted lines too — exactly what was
      // charged, not a re-derivation of it.
      navigate(`/receipt/${data.id}`, {
        state: { ...data, lines: garments.map((g) => ({ garmentType: g.garmentType, unitPrice: g.unitPrice })) },
      });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      {/* Phase 1: find or open a customer */}
      {!customer ? (
        <Card size="small" style={{ marginBlockEnd: 16, maxWidth: 640 }}>
          {searching ? (
            <Spin style={{ display: 'block', margin: '24px 0' }} />
          ) : (
            <CustomerPicker onSelect={openCustomer} />
          )}
        </Card>
      ) : (
        <Card size="small" style={{ marginBlockEnd: 16 }}>
          <Space size="large" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space size="large" wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {customer.fullName}
              </Typography.Title>
              <Typography.Text type="secondary">{customer.phone}</Typography.Text>
              <Tag color="gold">{String(customer.tier).toUpperCase()}</Tag>
              <Typography.Text type="secondary">
                {customer.lifetimeOrderCount} garments to date
              </Typography.Text>
              {customer.whatsappConsent && <Tag color="green">WhatsApp opted in</Tag>}
            </Space>
            <Button icon={<CloseOutlined />} onClick={changeCustomer}>
              Change customer
            </Button>
          </Space>
        </Card>
      )}

      {customer && (
        <Row gutter={16}>
          {/* Phase 1 §2: measurement verification on the 2D blueprint */}
          <Col xs={24} xl={11}>
            <Card
              title={`Measurements — ${activeGarmentType}`}
              size="small"
              extra={
                activeProfile ? (
                  <Tag color="blue">active v{String(activeProfile.version)}</Tag>
                ) : (
                  <Tag color="red">none on file</Tag>
                )
              }
              style={{ marginBlockEnd: 16 }}
            >
              <MeasurementDiagram
                points={activePoints}
                values={measurements}
                onChange={(k, v) => setMeasurements((m) => ({ ...m, [k]: v }))}
              />
              {garmentFamily(activeGarmentType) === 'trousers' && (
                <div style={{ marginBlockStart: 16 }}>
                  <Typography.Text strong style={{ fontSize: 13, color: '#00695C' }}>
                    Palla widths
                  </Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBlockEnd: 8 }}>
                    Add one row per waist pleat — a shalwar's pleat count varies per customer.
                  </Typography.Paragraph>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {pallas.map((p, i) => (
                      <Space key={i} align="start">
                        <Input
                          placeholder="Label"
                          value={p.label}
                          onChange={(e) =>
                            setPallas((rows) =>
                              rows.map((r, ri) => (ri === i ? { ...r, label: e.target.value } : r)),
                            )
                          }
                          style={{ width: 140 }}
                        />
                        <InputNumber
                          placeholder="Width"
                          min={0}
                          max={400}
                          step={0.5}
                          value={p.valueCm}
                          onChange={(v) =>
                            setPallas((rows) => rows.map((r, ri) => (ri === i ? { ...r, valueCm: v } : r)))
                          }
                          addonAfter="cm"
                        />
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setPallas((rows) => rows.filter((_, ri) => ri !== i))}
                        />
                      </Space>
                    ))}
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      block
                      onClick={() =>
                        setPallas((rows) => [...rows, { label: `Palla ${rows.length + 1}`, valueCm: null }])
                      }
                    >
                      Add palla
                    </Button>
                  </Space>
                </div>
              )}
              <Button
                type="primary"
                size="large"
                block
                style={{ marginBlockStart: 16 }}
                loading={savingM}
                onClick={saveMeasurements}
                disabled={!requiredMeasurementKeysFor(activeGarmentType).every((k) => measurements[k] != null)}
              >
                Save as new version
              </Button>
              {!requiredMeasurementKeysFor(activeGarmentType).every((k) => measurements[k] != null) && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {(() => {
                    const codes = requiredMeasurementKeysFor(activeGarmentType).map(
                      (k) => activePoints.find((p) => p.key === k)?.code,
                    );
                    return codes.length > 1
                      ? `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`
                      : codes[0];
                  })()}{' '}
                  {requiredMeasurementKeysFor(activeGarmentType).length > 1 ? 'are' : 'is'} required — the fabric
                  yield is calculated from{' '}
                  {requiredMeasurementKeysFor(activeGarmentType).length > 1 ? 'them' : 'it'}.
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
              {!hasAnyProfile ? (
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

                          {!profileFor(g.garmentType) && (
                            <Alert
                              type="warning"
                              showIcon
                              message={`No measurement profile saved for ${g.garmentType} yet`}
                              description="Switch to this tab's type in the Measurements panel and save one before a fabric roll can be selected."
                            />
                          )}

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

                          {g.garmentType !== 'Trousers' && (
                            <Row gutter={12}>
                              <Col span={12}>
                                <div style={{ fontSize: 13, color: '#757575' }}>Cut style</div>
                                <Select
                                  size="large"
                                  style={{ width: '100%' }}
                                  allowClear
                                  placeholder="Not specified"
                                  value={g.cutStyle}
                                  onChange={(v) => update(i, { cutStyle: v })}
                                  options={CUT_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
                                />
                              </Col>
                              <Col span={12}>
                                <div style={{ fontSize: 13, color: '#757575' }}>Cufflink size</div>
                                <Input
                                  size="large"
                                  placeholder="e.g. 9x3"
                                  value={g.cufflinkSize}
                                  onChange={(e) => update(i, { cufflinkSize: e.target.value })}
                                />
                              </Col>
                            </Row>
                          )}

                          <div>
                            <div style={{ fontSize: 13, color: '#757575' }}>
                              Fabric roll{' '}
                              {yieldByType[g.garmentType] != null && (
                                <Tag color="blue">needs {yieldByType[g.garmentType]!.toFixed(2)}m</Tag>
                              )}
                            </div>
                            <Select
                              size="large"
                              style={{ width: '100%' }}
                              disabled={!profileFor(g.garmentType) || g.customerSuppliesFabric}
                              placeholder={
                                (rollsByType[g.garmentType]?.length ?? 0) > 0
                                  ? 'Select a roll'
                                  : 'No roll can supply this yield'
                              }
                              value={g.customerSuppliesFabric ? undefined : g.fabricBatchId}
                              onChange={(v) => update(i, { fabricBatchId: v })}
                              options={(rollsByType[g.garmentType] ?? []).map((r) => ({
                                value: r.id,
                                label: `${r.fabricName} · ${r.batchCode}${r.origin ? ` · ${r.origin}` : ''} — ${r.available}m avail, ${r.remainderAfter}m after`,
                              }))}
                              notFoundContent={
                                <Typography.Text type="danger">
                                  Every roll would drop below its {rollsByType[g.garmentType]?.[0]?.minUsable ?? '3.50'}m minimum
                                </Typography.Text>
                              }
                            />
                            <Checkbox
                              style={{ marginBlockStart: 8 }}
                              checked={g.customerSuppliesFabric ?? false}
                              onChange={(e) =>
                                update(i, {
                                  customerSuppliesFabric: e.target.checked,
                                  fabricBatchId: e.target.checked ? undefined : g.fabricBatchId,
                                })
                              }
                            >
                              Customer supplies their own fabric — no roll deducted from stock
                            </Checkbox>
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

                  <Row gutter={16} align="middle" style={{ marginBlockStart: 16 }}>
                    <Col xs={12} md={6}>
                      <div style={{ fontSize: 13, color: '#757575' }}>Discount (SAR)</div>
                      <InputNumber
                        size="large"
                        min={0}
                        max={grossTotal}
                        value={discount}
                        onChange={(v) => setDiscount(v ?? 0)}
                        style={{ width: '100%' }}
                      />
                    </Col>
                    <Col xs={12} md={6}>
                      <div style={{ fontSize: 13, color: '#757575' }}>Due date</div>
                      <DatePicker
                        size="large"
                        style={{ width: '100%' }}
                        value={dueDate}
                        onChange={setDueDate}
                        disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <div style={{ fontSize: 13, color: '#757575' }}>Deposit method</div>
                      <Select
                        size="large"
                        style={{ width: '100%' }}
                        value={depositMethod}
                        onChange={setDepositMethod}
                        options={DEPOSIT_METHODS}
                      />
                    </Col>
                  </Row>

                  <Row style={{ marginBlockStart: 16 }}>
                    <Col span={24}>
                      <div style={{ fontSize: 13, color: '#757575' }}>Notes</div>
                      <Input.TextArea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Anything the workshop or next cashier should know"
                      />
                    </Col>
                  </Row>

                  <Row style={{ marginBlockStart: 12 }}>
                    <Col span={24}>
                      <Checkbox checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)}>
                        <Typography.Text strong={isUrgent} type={isUrgent ? 'danger' : undefined}>
                          Urgent order
                        </Typography.Text>
                      </Checkbox>
                    </Col>
                  </Row>

                  <Button
                    type="primary"
                    danger={isUrgent}
                    size="large"
                    block
                    icon={<ShoppingCartOutlined />}
                    style={{ marginBlockStart: 16, height: 56, fontSize: 18 }}
                    disabled={!readyToCheckout}
                    loading={submitting}
                    onClick={checkout}
                  >
                    {isUrgent && 'URGENT · '}Checkout · SAR {total.toFixed(2)}
                    {deposit > 0 && ` · deposit ${deposit.toFixed(2)}`}
                  </Button>
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
