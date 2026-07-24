import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../api';

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
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/customer/orders/${id}`)
      .then(({ data }) => setOrder(data))
      .catch((e) => setError(errMsg(e)));
  }, [id]);

  if (error) return <div className="page"><p className="error-text">{error}</p></div>;
  if (!order) return <div className="page"><p className="muted">Loading…</p></div>;

  const doneUpTo = order.timeline.filter((t) => t.reachedAt).length;
  const balance = (Number(order.totalAmount) - Number(order.paidAmount)).toFixed(2);

  return (
    <div className="page">
      <div className="row">
        <h2>{order.orderNumber}</h2>
        <span className={`badge ${order.status}`}>{order.status}</span>
      </div>
      <p className="muted">{order.store.name}</p>

      <div className="card">
        <div className="stepper">
          {order.timeline.map((t, i) => (
            <div
              key={t.step}
              className={`step ${t.reachedAt && !t.current ? 'done' : ''} ${t.current ? 'current' : ''} ${
                i < doneUpTo - 1 ? 'done' : ''
              }`}
            >
              <div className="step-dot">{t.reachedAt && !t.current ? '✓' : i + 1}</div>
              <span className="step-label">{t.step}</span>
              {t.reachedAt && (
                <span className="step-time">
                  {new Date(t.reachedAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16 }}>Details</h3>
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
          <span>Total: SAR {order.totalAmount}</span>
          <span>{Number(balance) > 0 ? `Balance: SAR ${balance}` : 'Paid in full'}</span>
        </div>
        {order.dueDate && <p className="muted">Estimated completion: {order.dueDate.slice(0, 10)}</p>}
      </div>

      <a
        className="fab-wa"
        href={`https://wa.me/${(order.store.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(
          `Hi, I have a question about order ${order.orderNumber}`,
        )}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat with us on WhatsApp"
      >
        💬
      </a>
    </div>
  );
}
