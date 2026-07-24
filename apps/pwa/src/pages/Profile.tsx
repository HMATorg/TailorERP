import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg, useAuth } from '../api';

interface Measurement {
  id: string;
  garmentType: string;
  data: Record<string, number | string>;
  createdAt: string;
  store: { name: string } | null;
}

export default function Profile() {
  const { customer, logout } = useAuth();
  const navigate = useNavigate();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/customer/measurements')
      .then(({ data }) => setMeasurements(data))
      .catch((e) => setError(errMsg(e)));
  }, []);

  const grouped = measurements.reduce<Record<string, Measurement[]>>((acc, m) => {
    (acc[m.garmentType] = acc[m.garmentType] ?? []).push(m);
    return acc;
  }, {});

  return (
    <div className="page">
      <h2>My Profile</h2>
      <div className="card">
        <strong>{customer?.fullName}</strong>
      </div>

      <h3 style={{ fontSize: 16 }}>My Measurements</h3>
      {error && <p className="error-text">{error}</p>}
      {measurements.length === 0 && <p className="muted">No measurements on file yet.</p>}
      {Object.entries(grouped).map(([garment, items]) => (
        <div className="card" key={garment}>
          <div
            className="row"
            style={{ cursor: 'pointer' }}
            onClick={() => setExpanded(expanded === garment ? null : garment)}
          >
            <strong>{garment}</strong>
            <span className="muted">
              {items.length} record{items.length > 1 ? 's' : ''} {expanded === garment ? '▴' : '▾'}
            </span>
          </div>
          {expanded === garment &&
            items.map((m) => (
              <div key={m.id} style={{ marginBlockStart: 10, borderBlockStart: '1px solid #eee', paddingBlockStart: 8 }}>
                <p className="muted" style={{ margin: 0 }}>
                  {new Date(m.createdAt).toLocaleDateString()} {m.store ? `— ${m.store.name}` : ''}
                </p>
                <table style={{ width: '100%', fontSize: 13, marginBlockStart: 6 }}>
                  <tbody>
                    {Object.entries(m.data).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: 'var(--color-grey)', textTransform: 'capitalize' }}>{k}</td>
                        <td style={{ textAlign: 'end' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      ))}

      <button
        className="btn btn-ghost"
        style={{ marginBlockStart: 16 }}
        onClick={() => {
          logout();
          navigate('/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
