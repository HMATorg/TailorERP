import { useCallback, useEffect, useState } from 'react';
import { SafetyCertificateOutlined } from '@ant-design/icons';
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
  message,
} from 'antd';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

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
