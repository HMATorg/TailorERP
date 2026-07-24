import { Badge, Select } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth';

const statusColor: Record<string, string> = {
  active: '#2E7D32',
  paused: '#F57F17',
  closed: '#C62828',
};

/** Wireframes §3.1: searchable store dropdown with status dots; HQ admins get "All Stores". */
export default function StoreSwitcher() {
  const { user, stores, activeStoreId, setActiveStore } = useAuthStore();
  const { t } = useTranslation();
  const isHq = user?.orgRole === 'hq_admin';

  const options = [
    ...(isHq
      ? [{ value: 'all', label: <span><ShopOutlined /> {t('store.allStores')}</span> }]
      : []),
    ...stores.map((s) => ({
      value: s.id,
      label: (
        <span>
          <Badge color={statusColor[s.status] ?? '#757575'} /> {s.name}
        </span>
      ),
    })),
  ];

  return (
    <Select
      value={activeStoreId ?? undefined}
      onChange={setActiveStore}
      options={options}
      style={{ minWidth: 240 }}
      showSearch
      optionFilterProp="value"
      filterOption={(input, option) => {
        if (option?.value === 'all') return 'all stores hq overview'.includes(input.toLowerCase());
        const store = stores.find((s) => s.id === option?.value);
        return (store?.name ?? '').toLowerCase().includes(input.toLowerCase());
      }}
    />
  );
}
