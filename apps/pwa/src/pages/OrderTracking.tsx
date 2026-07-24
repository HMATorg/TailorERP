import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import PushOptIn from '../components/PushOptIn';

interface Timeline {
  step: string;
  reachedAt: string | null;
  current: boolean;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  store: { name: string; phone: string | null; address: string | null };
  items: {
    garmentType: string;
    quantity: number;
    fabrics: { quantityUsed: string; batch: { fabricName: string; color: string | null } }[];
  }[];
  timeline: Timeline[];
}

export default function OrderTracking() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/customer/orders/${id}`)
      .then(({ data }) => setOrder(data))
      .catch((e) => setError(errMsg(e)));
  }, [id]);

  if (error) return <div className="page"><p className="error-text">{error}</p></div>;
  if (!order) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  const doneUpTo = order.timeline.filter((t) => t.reachedAt).length;
  const balance = (Number(order.totalAmount) - Number(order.paidAmount)).toFixed(2);

  return (
    <div className="page">
      <div className="row">
        <h2 dir="ltr">{order.orderNumber}</h2>
        <span className={`badge ${order.status}`}>{t(`status.${order.status}`, order.status)}</span>
      </div>
      <p className="muted">{order.store.name}</p>

      <div className="card">
        <div className="stepper">
          {order.timeline.map((step, i) => (
            <div
              key={step.step}
              className={`step ${step.reachedAt && !step.current ? 'done' : ''} ${
                step.current ? 'current' : ''
              } ${i < doneUpTo - 1 ? 'done' : ''}`}
            >
              <div className="step-dot">{step.reachedAt && !step.current ? '✓' : i + 1}</div>
              <span className="step-label">{t(`status.${step.step}`, step.step)}</span>
              {step.reachedAt && (
                <span className="step-time">
                  {new Date(step.reachedAt).toLocaleDateString(i18n.language, {
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16 }}>{t('orders.details')}</h3>
        {order.items.map((item, i) => (
          <div key={i} style={{ marginBlockEnd: 8 }}>
            <strong>
              {item.quantity}× {item.garmentType}
            </strong>
            {item.fabrics.length > 0 && (
              <p className="muted" style={{ margin: '2px 0' }}>
                {[...new Set(
                  item.fabrics.map(
                    (f) => `${f.batch.fabricName}${f.batch.color ? ` (${f.batch.color})` : ''}`,
                  ),
                )].join(', ')}
              </p>
            )}
          </div>
        ))}
        <div className="row muted">
          <span>
            {t('orders.total')}: SAR {order.totalAmount}
          </span>
          <span>
            {Number(balance) > 0
              ? `${t('orders.balance')}: SAR ${balance}`
              : t('orders.paidInFull')}
          </span>
        </div>
        {order.dueDate && (
          <p className="muted">
            {t('orders.estimatedCompletion', { date: order.dueDate.slice(0, 10) })}
          </p>
        )}
      </div>

      <a
        className="fab-wa"
        href={`https://wa.me/${(order.store.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(
          t('orders.chatPrefill', { number: order.orderNumber }),
        )}`}
        target="_blank"
        rel="noreferrer"
        aria-label={t('orders.chatAria')}
      >
        💬
      </a>

      <PushOptIn />
    </div>
  );
}
