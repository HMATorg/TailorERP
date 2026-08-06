import type { ReactNode } from 'react';
import { Typography } from 'antd';

const STROKE = '#455A64';
const FILL = '#ECEFF1';

/** Neckline glyphs — the V-opening + collar band shape is what actually differs. */
function CollarQallabi1() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M14 40 Q14 16 32 12 Q50 16 50 40" fill="none" stroke={STROKE} strokeWidth={2} />
      <path d="M24 16 L32 30 L40 16" fill="none" stroke={STROKE} strokeWidth={2.5} />
      <circle cx="32" cy="34" r="2" fill={STROKE} />
    </svg>
  );
}
function CollarQallabi2() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M14 40 Q14 16 32 12 Q50 16 50 40" fill="none" stroke={STROKE} strokeWidth={2} />
      <path d="M24 16 L32 30 L40 16" fill="none" stroke={STROKE} strokeWidth={2.5} />
      <circle cx="32" cy="32" r="2" fill={STROKE} />
      <circle cx="32" cy="40" r="2" fill={STROKE} />
    </svg>
  );
}
function CollarRoundedSada() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M14 40 Q14 16 32 12 Q50 16 50 40" fill="none" stroke={STROKE} strokeWidth={2} />
      <path d="M22 18 Q32 32 42 18" fill="none" stroke={STROKE} strokeWidth={2.5} />
    </svg>
  );
}
function CollarOpenV() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M14 40 Q14 16 32 12 Q50 16 50 40" fill="none" stroke={STROKE} strokeWidth={2} />
      <path d="M20 14 L32 38 L44 14" fill="none" stroke={STROKE} strokeWidth={2.5} />
    </svg>
  );
}

/** Cuff glyphs — cufflink dot vs. a row of sew-on buttons. */
function CuffFormalKabak() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <rect x="14" y="20" width="36" height="18" rx="2" fill={FILL} stroke={STROKE} strokeWidth={2} />
      <circle cx="32" cy="29" r="3.5" fill="none" stroke={STROKE} strokeWidth={2} />
      <line x1="14" y1="20" x2="8" y2="12" stroke={STROKE} strokeWidth={1.5} />
      <line x1="50" y1="20" x2="56" y2="12" stroke={STROKE} strokeWidth={1.5} />
    </svg>
  );
}
function CuffButtonedSada() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <rect x="14" y="20" width="36" height="18" rx="2" fill={FILL} stroke={STROKE} strokeWidth={2} />
      <circle cx="26" cy="29" r="2" fill={STROKE} />
      <circle cx="38" cy="29" r="2" fill={STROKE} />
    </svg>
  );
}

/** Pocket glyphs — a minimal torso outline with the pocket drawn where it actually sits. */
function PocketUpperLeftPatch() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M18 10 L46 10 L52 54 L12 54 Z" fill="none" stroke={STROKE} strokeWidth={1.5} opacity={0.5} />
      <rect x="20" y="20" width="14" height="16" rx="1.5" fill={FILL} stroke={STROKE} strokeWidth={2} />
    </svg>
  );
}
function PocketHiddenSide() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M18 10 L46 10 L52 54 L12 54 Z" fill="none" stroke={STROKE} strokeWidth={1.5} opacity={0.5} />
      <line x1="46" y1="22" x2="40" y2="38" stroke={STROKE} strokeWidth={2.5} strokeDasharray="1 3" strokeLinecap="round" />
    </svg>
  );
}
function PocketMobileSlot() {
  return (
    <svg viewBox="0 0 64 64" width={40} height={40}>
      <path d="M18 10 L46 10 L52 54 L12 54 Z" fill="none" stroke={STROKE} strokeWidth={1.5} opacity={0.5} />
      <rect x="19" y="18" width="16" height="20" rx="1.5" fill={FILL} stroke={STROKE} strokeWidth={2} />
      <line x1="27" y1="18" x2="27" y2="38" stroke={STROKE} strokeWidth={1.5} />
    </svg>
  );
}

const ICONS: Record<string, () => ReactNode> = {
  qallabi_1_button: CollarQallabi1,
  qallabi_2_button: CollarQallabi2,
  rounded_sada: CollarRoundedSada,
  open_v_neck: CollarOpenV,
  formal_kabak: CuffFormalKabak,
  buttoned_sada: CuffButtonedSada,
  upper_left_patch: PocketUpperLeftPatch,
  hidden_side: PocketHiddenSide,
  mobile_slot: PocketMobileSlot,
};

interface IconOption {
  value: string;
  en: string;
  ar: string;
}

interface StyleIconPickerProps {
  options: readonly IconOption[];
  value?: string;
  onChange: (value: string) => void;
  columns?: number;
}

/** Graphic icon selector for collar/cuff/pocket, replacing the plain text dropdown (D-071). */
export default function StyleIconPicker({ options, value, onChange, columns = 4 }: StyleIconPickerProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 8 }}>
      {options.map((o) => {
        const Icon = ICONS[o.value];
        const selected = value === o.value;
        return (
          <div
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              cursor: 'pointer',
              textAlign: 'center',
              border: selected ? '2px solid #00695C' : '1px solid #E0E0E0',
              background: selected ? '#E0F2F1' : '#fff',
              borderRadius: 6,
              padding: '6px 4px',
            }}
          >
            {Icon ? <Icon /> : <div style={{ width: 40, height: 40 }} />}
            <Typography.Text style={{ fontSize: 11, display: 'block', lineHeight: 1.2 }} ellipsis>
              {o.en}
            </Typography.Text>
          </div>
        );
      })}
    </div>
  );
}
