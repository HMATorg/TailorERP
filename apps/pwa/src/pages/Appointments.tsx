import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';

interface Appointment {
  id: string;
  appointmentType: string;
  scheduledAt: string;
  status: string;
  store: { id: string; name: string; address: string | null };
}

interface StoreOpt {
  id: string;
  name: string;
}

interface Slot {
  time: string;
  available: boolean;
}

const TYPE_VALUES = ['measurement', 'first_fitting', 'final_fitting', 'pickup'] as const;

export default function Appointments() {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<Appointment[]>([]);
  const [booking, setBooking] = useState(false);
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [type, setType] = useState('measurement');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get('/customer/appointments')
      .then(({ data }) => setList(data))
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!booking) return;
    api.get('/customer/stores').then(({ data }) => {
      setStores(data);
      if (data.length === 1) setStoreId(data[0].id);
    });
  }, [booking]);

  useEffect(() => {
    if (!storeId || !date) return;
    setSlot(null);
    api
      .get('/customer/availability', { params: { storeId, date } })
      .then(({ data }) => setSlots(data.slots))
      .catch((e) => setError(errMsg(e)));
  }, [storeId, date]);

  const confirm = async () => {
    setError(null);
    try {
      await api.post('/customer/appointments', {
        storeId,
        appointmentType: type,
        scheduledAt: slot,
      });
      setMsg(t('appointments.booked'));
      setBooking(false);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const cancel = async (id: string) => {
    try {
      await api.put(`/customer/appointments/${id}`, { status: 'cancelled' });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="page">
      <div className="row">
        <h2>{t('appointments.title')}</h2>
        <button className="btn" style={{ width: 'auto' }} onClick={() => setBooking((b) => !b)}>
          {booking ? t('app.close') : t('appointments.book')}
        </button>
      </div>
      {msg && <p style={{ color: 'var(--status-ready)' }}>{msg}</p>}
      {error && <p className="error-text">{error}</p>}

      {booking && (
        <div className="card">
          {stores.length > 1 && (
            <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">{t('appointments.chooseStore')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            style={{ marginBlock: 10 }}
          />
          {storeId && (
            <>
              <div className="slots-grid">
                {slots.map((s) => {
                  const label = new Date(s.time).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <button
                      key={s.time}
                      className={`slot ${!s.available ? 'booked' : ''} ${slot === s.time ? 'selected' : ''}`}
                      disabled={!s.available}
                      onClick={() => setSlot(s.time)}
                    >
                      {label}
                    </button>
                  );
                })}
                {slots.length === 0 && <p className="muted">{t('appointments.noSlots')}</p>}
              </div>
              <div style={{ marginBlock: 12 }}>
                {TYPE_VALUES.map((value) => (
                  <label key={value} style={{ display: 'inline-flex', alignItems: 'center', marginInlineEnd: 14 }}>
                    <input
                      type="radio"
                      name="type"
                      checked={type === value}
                      onChange={() => setType(value)}
                      style={{ marginInlineEnd: 4 }}
                    />
                    {t(`appointments.${value}`)}
                  </label>
                ))}
              </div>
              <button className="btn" disabled={!slot} onClick={() => void confirm()}>
                {t('appointments.confirm')}
              </button>
            </>
          )}
        </div>
      )}

      {list.length === 0 && !booking && <p className="muted">{t('appointments.none')}</p>}
      {list.map((a) => (
        <div className="card" key={a.id}>
          <div className="row">
            <strong>{t(`appointments.${a.appointmentType}`, a.appointmentType)}</strong>
            <span className={`badge ${a.status}`}>{t(`status.${a.status}`, a.status)}</span>
          </div>
          <p className="muted" style={{ marginBlock: 6 }}>
            {new Date(a.scheduledAt).toLocaleString(i18n.language, {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <div className="row">
            <span className="muted">{a.store.name}</span>
            {['scheduled', 'confirmed'].includes(a.status) && (
              <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 36 }} onClick={() => void cancel(a.id)}>
                {t('app.cancel')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
