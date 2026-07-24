import { useCallback, useEffect, useState } from 'react';
import { DatePicker, Select, Space, Table, Tag, Typography, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

const statusColors: Record<string, string> = {
  scheduled: 'blue',
  confirmed: 'cyan',
  in_progress: 'orange',
  completed: 'green',
  cancelled: 'red',
  no_show: 'volcano',
};

export default function Appointments() {
  const { activeStoreId } = useAuthStore();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const storeSelected = activeStoreId && activeStoreId !== 'all';

  const load = useCallback(async () => {
    if (!storeSelected) return;
    setLoading(true);
    try {
      const { data } = await api.get('/appointments', {
        params: { date: date.format('YYYY-MM-DD') },
      });
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [storeSelected, date]);

  useEffect(() => {
    void load();
  }, [load, activeStoreId]);

  if (!storeSelected) {
    return <Typography.Paragraph type="secondary">Select a store to view its appointments.</Typography.Paragraph>;
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/appointments/${id}`, { status });
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <DatePicker value={date} onChange={(d) => d && setDate(d)} allowClear={false} />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: 'Time',
            dataIndex: 'scheduledAt',
            render: (v: string) => dayjs(v).format('HH:mm'),
            sorter: (a: Record<string, unknown>, b: Record<string, unknown>) =>
              String(a.scheduledAt).localeCompare(String(b.scheduledAt)),
            defaultSortOrder: 'ascend',
          },
          {
            title: 'Customer',
            render: (_, r: Record<string, unknown>) => {
              const c = r.customer as { fullName: string; phone: string };
              return `${c.fullName} (${c.phone})`;
            },
          },
          { title: 'Type', dataIndex: 'appointmentType', render: (v: string) => v.replace('_', ' ') },
          { title: 'Duration', dataIndex: 'durationMinutes', render: (v: number) => `${v} min` },
          {
            title: 'Tailor',
            render: (_, r: Record<string, unknown>) =>
              (r.assignedTailor as { fullName?: string } | null)?.fullName ?? '—',
          },
          {
            title: 'Status',
            render: (_, r: Record<string, unknown>) => (
              <Select
                size="small"
                value={String(r.status)}
                style={{ width: 140 }}
                onChange={(v) => updateStatus(String(r.id), v)}
                options={Object.keys(statusColors).map((s) => ({
                  value: s,
                  label: <Tag color={statusColors[s]}>{s.replace('_', ' ')}</Tag>,
                }))}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
