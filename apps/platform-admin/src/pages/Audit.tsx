import { useCallback, useEffect, useState } from 'react';
import { Alert, Input, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';

const actorColors: Record<string, string> = {
  staff: 'blue',
  platform_admin: 'purple',
  impersonation: 'red',
  customer: 'green',
  system: 'default',
};

export default function Audit() {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('org') ?? undefined;
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  // Filled in once the first page of results carries the org's name (D-060).
  const [orgName, setOrgName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/audit-logs', {
        params: { action: action || undefined, organizationId, page },
      });
      setRows(data.items);
      setTotal(data.meta.total);
      const named = data.items.find((r: { organization?: { name?: string } }) => r.organization?.name);
      if (named) setOrgName(named.organization.name);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [action, organizationId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {organizationId && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete('org');
            setParams(next);
          }}
          message={`Filtered to ${orgName ?? 'this organisation'}'s audit trail`}
        />
      )}
      <Input.Search
        placeholder="Filter by action, e.g. order.status_changed"
        allowClear
        onSearch={(v) => {
          setPage(1);
          setAction(v);
        }}
        style={{ width: 340 }}
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (r: Record<string, unknown>) => (
            <pre style={{ fontSize: 12, margin: 0 }}>
              {JSON.stringify({ old: r.oldValue, new: r.newValue }, null, 2)}
            </pre>
          ),
        }}
        columns={[
          {
            title: 'When',
            dataIndex: 'createdAt',
            render: (v: string) => dayjs(v).format('DD MMM HH:mm:ss'),
            width: 140,
          },
          {
            title: 'Organisation',
            render: (_, r: Record<string, unknown>) =>
              (r.organization as { name?: string } | null)?.name ?? '—',
          },
          {
            title: 'Actor',
            render: (_, r: Record<string, unknown>) => (
              <Space size={4}>
                <Tag color={actorColors[String(r.actorType)]}>{String(r.actorType)}</Tag>
                {(r.actorUser as { email?: string } | null)?.email}
              </Space>
            ),
          },
          { title: 'Action', dataIndex: 'action', render: (v: string) => <code>{v}</code> },
          { title: 'Entity', dataIndex: 'entityType', render: (v) => v ?? '—' },
        ]}
      />
    </Space>
  );
}
