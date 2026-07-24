import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  store: { name: string };
  items: { garmentType: string; quantity: number }[];
}

export default function Orders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    api
      .get('/customer/orders')
      .then(({ data }) => setOrders(data))
      .catch((e) => setError(errMsg(e)));
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <div>
      {offline && <div className="offline-banner">{t('app.offline')}</div>}
      <div className="page">
        <h2>{t('orders.title')}</h2>
        {error && <p className="error-text">{error}</p>}
        {orders?.length === 0 && <p className="muted">{t('orders.none')}</p>}
        {(orders ?? []).map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              <div className="row">
                <strong dir="ltr">{o.orderNumber}</strong>
                <span className={`badge ${o.status}`}>{t(`status.${o.status}`, o.status)}</span>
              </div>
              <p className="muted" style={{ marginBlock: 6 }}>
                {o.items.map((i) => `${i.quantity}× ${i.garmentType}`).join(', ')}
              </p>
              <div className="row muted">
                <span>{o.store.name}</span>
                {o.dueDate && <span>{t('orders.due', { date: o.dueDate.slice(0, 10) })}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
