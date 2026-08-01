import { useCallback, useEffect, useState } from 'react';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { Button, Card, Input, Space, Table, Typography, message } from 'antd';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  totalAmount: string;
  netAmount: string;
  vatAmount: string;
  issuedAt: string;
  order: { orderNumber: string; customer: { fullName: string; phone: string } };
}

/** Browsable invoice history (D-062) — previously only reachable one order at a time via OrderDetail's reprint button. */
export default function InvoicesList() {
  const { activeStoreId } = useAuthStore();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<InvoiceRow[]>('/invoices');
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeStoreId && activeStoreId !== 'all') void load();
  }, [activeStoreId, load]);

  const download = async (row: InvoiceRow) => {
    setDownloadingId(row.id);
    try {
      const { data } = await api.get(`/invoices/${row.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${row.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.invoiceNumber.toLowerCase().includes(q) ||
      r.order.orderNumber.toLowerCase().includes(q) ||
      r.order.customer.fullName.toLowerCase().includes(q)
    );
  });

  if (!activeStoreId || activeStoreId === 'all') {
    return (
      <Typography.Text type="secondary">Select a store from the switcher above to view invoices.</Typography.Text>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <FileTextOutlined /> Invoices
        </Typography.Title>
        <Input.Search
          placeholder="Invoice #, order #, customer…"
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 280 }}
        />
      </Space>
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          columns={[
            { title: 'Invoice #', dataIndex: 'invoiceNumber' },
            { title: 'Order #', render: (_, r) => r.order.orderNumber },
            { title: 'Customer', render: (_, r) => r.order.customer.fullName },
            { title: 'Date', dataIndex: 'issuedAt', render: (v: string) => new Date(v).toLocaleDateString() },
            { title: 'Net (SAR)', dataIndex: 'netAmount' },
            { title: 'VAT (SAR)', dataIndex: 'vatAmount' },
            { title: 'Total (SAR)', dataIndex: 'totalAmount', render: (v: string) => <strong>{v}</strong> },
            {
              title: '',
              render: (_, r) => (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={downloadingId === r.id}
                  onClick={() => void download(r)}
                >
                  Download
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
