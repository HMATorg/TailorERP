import { useCallback, useEffect, useState } from 'react';
import { SafetyCertificateOutlined, ShopOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Popconfirm,
  Space,
  Steps,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface OrganizationProfile {
  name: string;
  vatNumber: string | null;
  crNumber: string | null;
  licenseNumber: string | null;
  logoUrl: string | null;
}

/** Keeps the login response and the localStorage-persisted auth store small. */
const MAX_LOGO_BYTES = 300 * 1024;

/**
 * Name, VAT/CR/license numbers, and logo — printed on every thermal receipt
 * and A4 tax invoice (D-069). Separate `Card` from the ZATCA onboarding below:
 * this is plain display data an owner edits directly, no CSID or OTP involved.
 */
function BusinessProfileCard() {
  const [form] = Form.useForm<{ name: string; vatNumber?: string; crNumber?: string; licenseNumber?: string }>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  const [savedLogoDataUri, setSavedLogoDataUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<OrganizationProfile>('/organization');
      form.setFieldsValue({
        name: data.name,
        vatNumber: data.vatNumber ?? undefined,
        crNumber: data.crNumber ?? undefined,
        licenseNumber: data.licenseNumber ?? undefined,
      });
      setLogoDataUri(data.logoUrl);
      setSavedLogoDataUri(data.logoUrl);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickLogo = (file: File): boolean => {
    if (file.size > MAX_LOGO_BYTES) {
      message.error(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)}KB`);
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUri(reader.result as string);
    reader.onerror = () => message.error('Could not read that file');
    reader.readAsDataURL(file);
    return false; // handled entirely client-side — no auto-upload to any endpoint
  };

  const save = async (v: { name: string; vatNumber?: string; crNumber?: string; licenseNumber?: string }) => {
    setSaving(true);
    try {
      await api.put('/organization', {
        ...v,
        // Only sent when the logo actually changed — a null clears it, an
        // unchanged image is never re-uploaded on every unrelated save.
        ...(logoDataUri !== savedLogoDataUri ? { logoUrl: logoDataUri } : {}),
      });
      message.success('Business profile saved');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card loading={loading} style={{ marginBlockEnd: 16 }}>
      <Typography.Title level={5} style={{ marginBlockStart: 0 }}>
        <ShopOutlined /> Business Profile
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Printed on every thermal receipt and A4 tax invoice — name, VAT/CR/license numbers, and logo.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label="Business name" rules={[{ required: true }]}>
          <Input placeholder="Al Anwar Tailors" />
        </Form.Item>
        <Form.Item name="vatNumber" label="VAT registration number">
          <Input placeholder="300012345600003" />
        </Form.Item>
        <Form.Item name="crNumber" label="Commercial Registration (CR) number">
          <Input />
        </Form.Item>
        <Form.Item name="licenseNumber" label="License number">
          <Input />
        </Form.Item>
        <Form.Item label="Logo">
          <Space align="start">
            {logoDataUri && (
              <img
                src={logoDataUri}
                alt="Business logo"
                style={{ maxWidth: 120, maxHeight: 80, border: '1px solid #E0E0E0', borderRadius: 4, padding: 4 }}
              />
            )}
            <Space direction="vertical">
              <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={pickLogo}>
                <Button icon={<UploadOutlined />}>{logoDataUri ? 'Replace logo' : 'Upload logo'}</Button>
              </Upload>
              {logoDataUri && (
                <Button size="small" danger type="text" onClick={() => setLogoDataUri(null)}>
                  Remove logo
                </Button>
              )}
            </Space>
          </Space>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>
          Save business profile
        </Button>
      </Form>
    </Card>
  );
}

type OnboardingStage = 'not_started' | 'compliance' | 'production';

interface OnboardingStatus {
  stage: OnboardingStage;
  hasCredentials: boolean;
}

interface ComplianceCheckResult {
  invoiceTypeCode: 'standard' | 'simplified';
  [key: string]: unknown;
}

const STAGE_INDEX: Record<OnboardingStage, number> = { not_started: 0, compliance: 1, production: 2 };

/** CSR fields the backend's `generateCsr()` needs (D-057/D-058). */
interface CsrFormValues {
  otp: string;
  commonName: string;
  egsSerialNumber: string;
  organizationIdentifier: string;
  organizationUnitName: string;
  organizationName: string;
  countryName: string;
  invoiceType: string;
  location: string;
  industry: string;
}

export default function Settings() {
  const { user } = useAuthStore();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkResults, setCheckResults] = useState<ComplianceCheckResult[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<OnboardingStatus>('/zatca/onboarding/status');
      setStatus(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const csrDefaults: Partial<CsrFormValues> = {
    organizationName: user?.organization.name ?? '',
    organizationIdentifier: '',
    countryName: 'SA',
    invoiceType: '1100',
  };

  const requestComplianceCsid = async (v: CsrFormValues) => {
    setBusy(true);
    try {
      await api.post('/zatca/onboarding/compliance-csid', v);
      message.success('Compliance CSID issued');
      setCheckResults(null);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runComplianceChecks = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/zatca/onboarding/compliance-checks');
      setCheckResults(data.results);
      message.success(`Compliance checks submitted (${data.checksRun} of 6 — see note below)`);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const requestProductionCsid = async () => {
    setBusy(true);
    try {
      await api.post('/zatca/onboarding/production-csid');
      message.success('Production CSID issued — live invoice submission is now enabled');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const renew = async (v: CsrFormValues) => {
    setBusy(true);
    try {
      await api.post('/zatca/onboarding/renew', v);
      message.success('Production CSID renewed');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.post('/zatca/onboarding/revoke');
      message.success('ZATCA credentials revoked locally — re-onboarding is required before invoices can be submitted');
      setCheckResults(null);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const stage = status?.stage ?? 'not_started';

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <BusinessProfileCard />

      <Typography.Title level={4} style={{ margin: 0 }}>
        <SafetyCertificateOutlined /> Settings — ZATCA E-Invoicing
      </Typography.Title>

      <Card loading={loading}>
        <Steps
          size="small"
          current={STAGE_INDEX[stage]}
          items={[
            { title: 'Compliance CSID', description: 'Submit CSR + OTP from the FATOORA portal' },
            { title: 'Compliance checks', description: 'Submit sample invoices for validation' },
            { title: 'Production CSID', description: 'Enable live invoice submission' },
          ]}
        />

        <Divider />

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="The OTP below must come from the real ZATCA FATOORA portal (or Developer Portal sandbox) — this system cannot obtain one for you."
        />

        {stage === 'not_started' && (
          <Form<CsrFormValues> layout="vertical" initialValues={csrDefaults} onFinish={requestComplianceCsid}>
            <Form.Item name="otp" label="OTP" rules={[{ required: true, min: 4 }]}>
              <Input placeholder="123456" />
            </Form.Item>
            <Form.Item name="commonName" label="Common Name (device/asset name)" rules={[{ required: true }]}>
              <Input placeholder="Al Anwar Tailors — Jeddah POS 1" />
            </Form.Item>
            <Form.Item name="egsSerialNumber" label="EGS Serial Number" rules={[{ required: true }]}>
              <Input placeholder="1-Tailonix|2-1.0|3-<uuid>" />
            </Form.Item>
            <Form.Item
              name="organizationIdentifier"
              label="VAT Registration Number (15 digits)"
              rules={[{ required: true, len: 15, message: 'Must be exactly 15 digits' }]}
            >
              <Input placeholder="300012345600003" />
            </Form.Item>
            <Form.Item name="organizationUnitName" label="Organization Unit" rules={[{ required: true }]}>
              <Input placeholder="Jeddah — Corniche" />
            </Form.Item>
            <Form.Item name="organizationName" label="Organization Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="countryName" label="Country (ISO 3166 alpha-2)" rules={[{ required: true, len: 2 }]}>
              <Input maxLength={2} />
            </Form.Item>
            <Form.Item name="invoiceType" label="Invoice Type (TSXY digits)" rules={[{ required: true, len: 4 }]}>
              <Input maxLength={4} />
            </Form.Item>
            <Form.Item name="location" label="Location" rules={[{ required: true }]}>
              <Input placeholder="Jeddah, Al Andalus District" />
            </Form.Item>
            <Form.Item name="industry" label="Industry" rules={[{ required: true }]}>
              <Input placeholder="Tailoring and garment manufacturing" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              Request Compliance CSID
            </Button>
          </Form>
        )}

        {stage === 'compliance' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type="warning"
              showIcon
              message="Compliance-stage credential — usable only for compliance checks, not for real invoice submission."
            />
            <Space>
              <Button onClick={runComplianceChecks} loading={busy}>
                Run compliance checks
              </Button>
              <Button type="primary" onClick={requestProductionCsid} loading={busy}>
                Request Production CSID
              </Button>
            </Space>

            {checkResults && (
              <>
                <Divider orientation="left" plain>
                  Compliance check results
                </Divider>
                <Alert
                  type="info"
                  showIcon
                  message="Covers standard and simplified tax invoices only — this system does not yet model credit/debit notes, so it cannot run ZATCA's full 6-document compliance suite."
                  style={{ marginBottom: 12 }}
                />
                <Space direction="vertical" style={{ width: '100%' }}>
                  {checkResults.map((r, i) => (
                    <Card key={i} size="small">
                      <Space>
                        <Tag>{r.invoiceTypeCode}</Tag>
                        <Typography.Text code>{JSON.stringify(r)}</Typography.Text>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </>
            )}
          </Space>
        )}

        {stage === 'production' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="success" showIcon message="Production CSID active — live invoice submission is enabled." />
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Stage">
                <Tag color="green">Production</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Credentials on file">{status?.hasCredentials ? 'Yes' : 'No'}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" plain>
              Renew Production CSID
            </Divider>
            <Typography.Paragraph type="secondary">
              Requires a fresh OTP from the FATOORA portal, same as initial onboarding.
            </Typography.Paragraph>
            <Form<CsrFormValues> layout="vertical" initialValues={csrDefaults} onFinish={renew}>
              <Form.Item name="otp" label="OTP" rules={[{ required: true, min: 4 }]}>
                <Input placeholder="123456" />
              </Form.Item>
              <Form.Item name="commonName" label="Common Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="egsSerialNumber" label="EGS Serial Number" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="organizationIdentifier" label="VAT Registration Number" rules={[{ required: true, len: 15 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="organizationUnitName" label="Organization Unit" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="organizationName" label="Organization Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="countryName" label="Country" rules={[{ required: true, len: 2 }]}>
                <Input maxLength={2} />
              </Form.Item>
              <Form.Item name="invoiceType" label="Invoice Type" rules={[{ required: true, len: 4 }]}>
                <Input maxLength={4} />
              </Form.Item>
              <Form.Item name="location" label="Location" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="industry" label="Industry" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Button htmlType="submit" loading={busy}>
                Renew Production CSID
              </Button>
            </Form>

            <Divider orientation="left" plain>
              Danger zone
            </Divider>
            <Popconfirm
              title="Revoke ZATCA credentials locally?"
              description="This immediately stops invoice submission until you re-onboard. It does not revoke the CSID on ZATCA's own portal — do that separately if the device is compromised."
              onConfirm={revoke}
            >
              <Button danger loading={busy}>
                Revoke locally
              </Button>
            </Popconfirm>
          </Space>
        )}
      </Card>
    </Space>
  );
}
