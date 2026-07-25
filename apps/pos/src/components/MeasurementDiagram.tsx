import { InputNumber, Tooltip } from 'antd';
import { MEASUREMENT_POINTS, type MeasurementKey } from '../api';

interface Props {
  values: Partial<Record<MeasurementKey, number | null>>;
  onChange: (key: MeasurementKey, value: number | null) => void;
  readOnly?: boolean;
  lang?: 'en' | 'ar';
}

/**
 * Interactive 2D thobe blueprint (v4 Phase 1 §2). Each M-point is a hotspot on
 * the garment outline; tapping one focuses its field. Drawn as inline SVG so it
 * scales on a counter tablet without raster assets.
 */
const HOTSPOTS: Record<MeasurementKey, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = {
  m1TotalLength: { x: 158, y: 200, anchor: 'start' },
  m2ShoulderWidth: { x: 100, y: 46, anchor: 'middle' },
  m3SleeveLength: { x: 36, y: 130, anchor: 'end' },
  m4ChestCirc: { x: 100, y: 95, anchor: 'middle' },
  m5HipWidth: { x: 100, y: 160, anchor: 'middle' },
  m6NeckDiameter: { x: 100, y: 28, anchor: 'middle' },
  m7WristOpening: { x: 30, y: 196, anchor: 'end' },
  m8SkirtPerimeter: { x: 100, y: 322, anchor: 'middle' },
};

export default function MeasurementDiagram({ values, onChange, readOnly, lang = 'en' }: Props) {
  const label = (p: (typeof MEASUREMENT_POINTS)[number]) => (lang === 'ar' ? p.ar : p.en);

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <svg viewBox="0 0 200 350" style={{ width: 210, flexShrink: 0 }} aria-label="Thobe measurement diagram">
        {/* Thobe outline: neck, shoulders, sleeves, body flaring to the hem */}
        <path
          d="M85 20 Q100 12 115 20 L150 34 L172 120 L156 128 L150 92 L150 330 L50 330 L50 92 L44 128 L28 120 L50 34 Z"
          fill="#E0F2F1"
          stroke="#00695C"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* collar opening */}
        <path d="M85 20 Q100 34 115 20" fill="none" stroke="#00695C" strokeWidth="2.5" />
        {/* front placket */}
        <line x1="100" y1="30" x2="100" y2="120" stroke="#00695C" strokeWidth="1.5" strokeDasharray="4 3" />

        {MEASUREMENT_POINTS.map((point) => {
          const spot = HOTSPOTS[point.key];
          const filled = values[point.key] != null;
          return (
            <g key={point.key}>
              <circle
                cx={spot.x}
                cy={spot.y}
                r="11"
                fill={filled ? '#00695C' : '#FFFFFF'}
                stroke="#00695C"
                strokeWidth="2"
              />
              <text
                x={spot.x}
                y={spot.y + 4}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill={filled ? '#FFFFFF' : '#00695C'}
              >
                {point.code}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12, flex: 1, minWidth: 260 }}>
        {MEASUREMENT_POINTS.map((point) => (
          <div key={point.key}>
            <div style={{ fontSize: 13, color: '#757575', marginBlockEnd: 4 }}>
              <Tooltip title={`${point.en} — ${point.ar}`}>
                <b style={{ color: '#00695C' }}>{point.code}</b>
              </Tooltip>{' '}
              {label(point)}
            </div>
            <InputNumber
              value={values[point.key] ?? null}
              onChange={(v) => onChange(point.key, v)}
              disabled={readOnly}
              min={0}
              max={400}
              step={0.5}
              addonAfter="cm"
              size="large"
              style={{ width: '100%' }}
              inputMode="decimal"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
