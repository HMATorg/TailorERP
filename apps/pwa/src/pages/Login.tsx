import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES } from '@tailonix/shared';
import { api, errMsg, useAuth } from '../api';
import { LANGUAGE_LABELS } from '../i18n';

const OTP_LENGTH = 4;

export default function Login() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const setSession = useAuth((s) => s.setSession);
  const [phone, setPhone] = useState('+966');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const submitted = useRef(false);

  // Fires however the digits arrive: typed, pasted, or dev-autofilled.
  useEffect(() => {
    if (stage === 'code' && digits.every((d) => d !== '') && !submitted.current) {
      submitted.current = true;
      void verify(digits.join(''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, stage]);

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/customer/auth/otp', { phone });
      setStage('code');
      setResendIn(45);
      const timer = setInterval(() => {
        setResendIn((s) => {
          if (s <= 1) clearInterval(timer);
          return s - 1;
        });
      }, 1000);
      // dev convenience: server returns the code outside production
      if (data.devCode) setDigits(String(data.devCode).split(''));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/customer/auth/verify', { phone, code });
      setSession(data);
      navigate('/');
    } catch (e) {
      setError(errMsg(e));
      setDigits(Array(OTP_LENGTH).fill(''));
      submitted.current = false;
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onDigit = (i: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < OTP_LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  return (
    <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '90dvh' }}>
      <div className="card" style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <select
            aria-label="Language"
            value={i18n.language.split('-')[0]}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            style={{ border: 'none', background: 'transparent', color: 'var(--color-grey)' }}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <h1>{t('app.name')}</h1>
        {stage === 'phone' ? (
          <>
            <p className="muted">{t('app.tagline')}</p>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+9665xxxxxxxx"
              style={{ marginBlock: 12, textAlign: 'center' }}
            />
            {error && <p className="error-text">{error}</p>}
            <button className="btn" disabled={busy || !/^\+[1-9]\d{7,14}$/.test(phone)} onClick={() => void requestOtp()}>
              {busy ? t('login.sending') : t('login.sendOtp')}
            </button>
            <p className="muted" style={{ marginBlockStart: 10 }}>
              {t('login.codeHint', { length: OTP_LENGTH })}
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              {t('login.enterCodeSentTo')} <b dir="ltr">{phone}</b>
            </p>
            <div className="otp-row" style={{ marginBlock: 16 }} dir="ltr">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  className="otp-box"
                  inputMode="numeric"
                  value={d}
                  onChange={(e) => onDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                  }}
                />
              ))}
            </div>
            {error && <p className="error-text">{error}</p>}
            <button
              className="btn btn-ghost"
              disabled={resendIn > 0 || busy}
              onClick={() => void requestOtp()}
            >
              {resendIn > 0
                ? t('login.resendIn', { seconds: String(resendIn).padStart(2, '0') })
                : t('login.resend')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
