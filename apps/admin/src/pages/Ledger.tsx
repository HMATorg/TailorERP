import { useCallback, useEffect, useState } from 'react';
import { BookOutlined } from '@ant-design/icons';
import { Alert, Card, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { api, errMsg } from '../api/client';

interface AccountRow {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit: string;
  credit: string;
  balance: string;
}

interface TrialBalance {
  asOf: string | null;
  accounts: AccountRow[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

interface StatementLine {
  entryNumber: number;
  postedAt: string;
  source: string;
  memo: string | null;
  debit: string;
  credit: string;
}

const typeColors: Record<string, string> = { asset: 'blue', liability: 'orange', revenue: 'green' };

/** Trial balance + per-account drill-down (D-062) — the double-entry ledger from D-036/D-037 had no UI at all until now. */
export default function Ledger() {
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<{ account: AccountRow; lines: StatementLine[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let { data: tb } = await api.get<TrialBalance>('/ledger/trial-balance');
      if (tb.accounts.length === 0) {
        // First visit for this tenant — the standard chart of accounts is safe to
        // set up on demand rather than requiring a separate manual step.
        await api.post('/ledger/accounts/bootstrap');
        ({ data: tb } = await api.get<TrialBalance>('/ledger/trial-balance'));
      }
      setData(tb);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openStatement = async (account: AccountRow) => {
    try {
      const { data: stmt } = await api.get(`/ledger/accounts/${account.code}`);
      setStatement({ account, lines: stmt.lines });
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        <BookOutlined /> Ledger — Trial Balance
      </Typography.Title>

      {data && !data.balanced && (
        <Alert type="error" showIcon message="The ledger does not balance — this should never happen; contact support." />
      )}

      <Card loading={loading}>
        <Table
          rowKey="code"
          size="small"
          pagination={false}
          dataSource={data?.accounts ?? []}
          onRow={(row) => ({ style: { cursor: 'pointer' }, onClick: () => void openStatement(row) })}
          columns={[
            { title: 'Account', dataIndex: 'name' },
            { title: 'Type', dataIndex: 'type', render: (v: string) => <Tag color={typeColors[v]}>{v}</Tag> },
            { title: 'Debit (SAR)', dataIndex: 'debit', align: 'right' as const },
            { title: 'Credit (SAR)', dataIndex: 'credit', align: 'right' as const },
            {
              title: 'Balance (SAR)',
              dataIndex: 'balance',
              align: 'right' as const,
              render: (v: string) => <strong>{v}</strong>,
            },
          ]}
          summary={() =>
            data && (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <strong>Total</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>{data.totalDebit}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <strong>{data.totalCredit}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} />
              </Table.Summary.Row>
            )
          }
        />
      </Card>

      <Modal
        open={!!statement}
        title={statement?.account.name}
        onCancel={() => setStatement(null)}
        footer={null}
        width={720}
      >
        <Table
          rowKey="entryNumber"
          size="small"
          pagination={{ pageSize: 20 }}
          dataSource={statement?.lines ?? []}
          columns={[
            { title: '#', dataIndex: 'entryNumber', width: 60 },
            { title: 'Date', dataIndex: 'postedAt', render: (v: string) => new Date(v).toLocaleDateString() },
            { title: 'Source', dataIndex: 'source', render: (v: string) => <Tag>{v}</Tag> },
            { title: 'Memo', dataIndex: 'memo' },
            { title: 'Debit', dataIndex: 'debit', align: 'right' as const },
            { title: 'Credit', dataIndex: 'credit', align: 'right' as const },
          ]}
        />
      </Modal>
    </Space>
  );
}
