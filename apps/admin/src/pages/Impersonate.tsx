import { useEffect, useState } from 'react';
import { Card, Result, Spin } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

/**
 * Impersonation handoff (D-060): platform-admin mints a short-lived staff
 * token and links here with it in the URL. `GET /auth/session` resolves it
 * into the same `{user, stores}` shape a real login returns, since the raw
 * token alone isn't enough to populate this app's session store correctly —
 * that's what made the previous "paste this into session storage"
 * instruction unusable in practice.
 */
export default function Impersonate() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const startImpersonatedSession = useAuthStore((s) => s.startImpersonatedSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing impersonation token');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/v1/auth/session', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        startImpersonatedSession(token, data.user, data.stores);
        navigate('/', { replace: true });
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#E0F2F1' }}>
      <Card style={{ width: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {error ? (
          <Result
            status="error"
            title="Could not start impersonated session"
            subTitle={error}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="large" />
            <p style={{ marginTop: 16 }}>Starting impersonated session…</p>
          </div>
        )}
      </Card>
    </div>
  );
}
