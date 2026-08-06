import { useRef, useState } from 'react';
import { Col, InputNumber, Row, Segmented, Tooltip } from 'antd';
import { MEASUREMENT_POINTS, TROUSER_MEASUREMENT_POINTS, type MeasurementKey } from '../api';

type Point = (typeof MEASUREMENT_POINTS)[number] | (typeof TROUSER_MEASUREMENT_POINTS)[number];
type Unit = 'cm' | 'in';
type InputHandle = { focus: () => void } | null;

interface Props {
  points?: readonly Point[];
  values: Partial<Record<MeasurementKey, number | null>>;
  onChange: (key: MeasurementKey, value: number | null) => void;
  readOnly?: boolean;
  lang?: 'en' | 'ar';
}

const CM_PER_IN = 2.54;

/**
 * One hotspot's layout: `x`/`y` is where the clickable label circle sits —
 * always off the garment, in a left/right margin column, so 13 points never
 * crowd each other regardless of how many share a body region. `targetX`/
 * `targetY` is the actual point on the body the label refers to; a thin
 * leader line connects the two, the way a tailor's spec sheet annotates a
 * flat sketch. `span`, where given, draws a dimension-line arrow across (or
 * along) the body at that point — a width/circumference reads as a width on
 * the drawing, not just a dot, which is the actual fix for "the graphic
 * doesn't show what's being measured."
 */
interface HotspotLayout {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  span?: { x1: number; y1: number; x2: number; y2: number };
}

const ROBE_HOTSPOTS: Record<string, HotspotLayout> = {
  // Left column
  m6NeckDiameter: { x: 42, y: 28, targetX: 150, targetY: 30 },
  m10RoundShoulder: { x: 42, y: 64, targetX: 115, targetY: 50 },
  // Sleeve split left/right (D-068) — targets the two cuffs the outline
  // already draws (one at each side), rather than assuming symmetry.
  m3SleeveLeft: { x: 42, y: 100, targetX: 78, targetY: 120 },
  m3SleeveRight: { x: 42, y: 136, targetX: 232, targetY: 120 },
  m11MidHand: { x: 42, y: 172, targetX: 80, targetY: 148 },
  m12PlateLength: { x: 42, y: 208, targetX: 160, targetY: 95 },
  m7WristOpening: { x: 42, y: 244, targetX: 88, targetY: 153 },
  m13HalfChest: { x: 42, y: 280, targetX: 110, targetY: 130 },
  // Right column
  m2ShoulderWidth: { x: 278, y: 50, targetX: 225, targetY: 55, span: { x1: 95, y1: 42, x2: 225, y2: 42 } },
  m4ChestCirc: { x: 278, y: 95, targetX: 225, targetY: 130, span: { x1: 95, y1: 130, x2: 225, y2: 130 } },
  // Total length split front/back (D-068) — two parallel dimension lines
  // rather than one, since a robe's front and back panels are legitimately
  // cut to different lengths.
  m1FrontLength: { x: 278, y: 140, targetX: 225, targetY: 200, span: { x1: 245, y1: 60, x2: 245, y2: 350 } },
  m1BackLength: { x: 278, y: 178, targetX: 210, targetY: 200, span: { x1: 262, y1: 60, x2: 262, y2: 350 } },
  m9Waist: { x: 278, y: 216, targetX: 215, targetY: 190, span: { x1: 100, y1: 190, x2: 220, y2: 190 } },
  m5HipWidth: { x: 278, y: 258, targetX: 220, targetY: 250, span: { x1: 95, y1: 250, x2: 225, y2: 250 } },
  m8SkirtPerimeter: { x: 278, y: 300, targetX: 215, targetY: 350, span: { x1: 95, y1: 350, x2: 225, y2: 350 } },
};

const TROUSER_HOTSPOTS: Record<string, HotspotLayout> = {
  // Left column
  t1Waist: { x: 42, y: 50, targetX: 160, targetY: 52, span: { x1: 135, y1: 52, x2: 185, y2: 52 } },
  t3Inseam: { x: 42, y: 130, targetX: 160, targetY: 270, span: { x1: 160, y1: 196, x2: 160, y2: 350 } },
  t5Thigh: { x: 42, y: 210, targetX: 152, targetY: 230, span: { x1: 148, y1: 230, x2: 206, y2: 230 } },
  t6Knee: { x: 42, y: 290, targetX: 156, targetY: 300, span: { x1: 152, y1: 300, x2: 206, y2: 300 } },
  // Right column
  t2Hip: { x: 278, y: 70, targetX: 200, targetY: 90, span: { x1: 114, y1: 90, x2: 206, y2: 90 } },
  t4Outseam: { x: 278, y: 150, targetX: 225, targetY: 220, span: { x1: 225, y1: 90, x2: 225, y2: 350 } },
  t7AnkleOpening: { x: 278, y: 230, targetX: 190, targetY: 350, span: { x1: 148, y1: 350, x2: 206, y2: 350 } },
};

const ROBE_BODY_D =
  'M130 35 Q160 20 190 35 L225 55 L255 145 L235 155 L225 115 L225 355 L95 355 L95 115 L85 155 L65 145 L95 55 Z';
const ROBE_COLLAR_D = 'M130 35 Q160 55 190 35';
const TROUSER_BODY_D =
  'M120 50 Q160 36 200 50 L206 188 L206 350 L172 350 L168 196 L152 196 L148 350 L114 350 L114 188 Z';
const TROUSER_WAISTBAND_D = 'M120 50 Q160 40 200 50';

/** `thumb` skips the `<defs>` gradient — cheap and, more importantly, avoids
 * duplicate `id="robeFill"`/`id="trouserFill"` when a dozen per-point
 * thumbnails (below) each render their own copy of this outline. */
function RobeOutline({ thumb }: { thumb?: boolean } = {}) {
  return (
    <>
      {!thumb && (
        <defs>
          <linearGradient id="robeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1FAF9" />
            <stop offset="100%" stopColor="#CFEDE9" />
          </linearGradient>
        </defs>
      )}
      {/* Thobe/Bisht/Shirt outline: neck, shoulders, sleeves, body flaring to the hem */}
      <path
        d={ROBE_BODY_D}
        fill={thumb ? '#DCEEEC' : 'url(#robeFill)'}
        stroke="#00695C"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* collar opening */}
      <path d={ROBE_COLLAR_D} fill="none" stroke="#00695C" strokeWidth="2.5" />
      {/* front placket */}
      <line x1="160" y1="45" x2="160" y2="150" stroke="#00695C" strokeWidth="1.5" strokeDasharray="4 3" />
    </>
  );
}

function TrousersOutline({ thumb }: { thumb?: boolean } = {}) {
  return (
    <>
      {!thumb && (
        <defs>
          <linearGradient id="trouserFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1FAF9" />
            <stop offset="100%" stopColor="#CFEDE9" />
          </linearGradient>
        </defs>
      )}
      {/* Waistband, splitting into two legs at the crotch */}
      <path
        d={TROUSER_BODY_D}
        fill={thumb ? '#DCEEEC' : 'url(#trouserFill)'}
        stroke="#00695C"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* waistband line */}
      <path d={TROUSER_WAISTBAND_D} fill="none" stroke="#00695C" strokeWidth="2.5" />
      {/* centre crease on each leg */}
      <line x1="189" y1="80" x2="189" y2="340" stroke="#00695C" strokeWidth="1" strokeDasharray="4 3" />
      <line x1="131" y1="80" x2="131" y2="340" stroke="#00695C" strokeWidth="1" strokeDasharray="4 3" />
    </>
  );
}

/** A tailor's-spec-sheet dimension line: the span being measured, with tick-mark ends. */
function DimensionLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const vertical = x1 === x2;
  const tick = 5;
  return (
    <g stroke="#FB8C00" strokeWidth="1.25" opacity={0.9}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} />
          <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} />
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} />
          <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} />
        </>
      )}
    </g>
  );
}

/**
 * A tight crop of the same body outline around one point's own region — each
 * measurement field gets its own reference picture instead of everyone
 * sharing the single full-body diagram (D-071). Reuses `RobeOutline`/
 * `TrousersOutline` and each hotspot's existing `target`/`span` data; no new
 * illustration work, just a `viewBox` that zooms into that point's corner.
 */
function PointThumbnail({ spot, isTrousers }: { spot: HotspotLayout; isTrousers: boolean }) {
  const xs = [spot.targetX, spot.span?.x1, spot.span?.x2].filter((n): n is number => n != null);
  const ys = [spot.targetY, spot.span?.y1, spot.span?.y2].filter((n): n is number => n != null);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 34;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = Math.max(maxX - minX, maxY - minY, 70) + pad * 2;
  const vx = cx - size / 2;
  const vy = cy - size / 2;
  return (
    <svg
      viewBox={`${vx} ${vy} ${size} ${size}`}
      width={48}
      height={48}
      style={{ border: '1px solid #E0E0E0', borderRadius: 6, background: '#FAFAFA', flexShrink: 0 }}
      aria-hidden
    >
      {isTrousers ? <TrousersOutline thumb /> : <RobeOutline thumb />}
      {spot.span && <DimensionLine {...spot.span} />}
      <circle cx={spot.targetX} cy={spot.targetY} r={5} fill="#FFA000" stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

export default function MeasurementDiagram({ points = MEASUREMENT_POINTS, values, onChange, readOnly, lang = 'en' }: Props) {
  const label = (p: Point) => (lang === 'ar' ? p.ar : p.en);
  const isTrousers = points[0]?.key.startsWith('t') ?? false;
  const hotspots = isTrousers ? TROUSER_HOTSPOTS : ROBE_HOTSPOTS;

  const [unit, setUnit] = useState<Unit>('cm');
  const [activeKey, setActiveKey] = useState<MeasurementKey | null>(null);
  const inputRefs = useRef<Partial<Record<MeasurementKey, InputHandle>>>({});
  const fieldRefs = useRef<Partial<Record<MeasurementKey, HTMLDivElement | null>>>({});

  const toDisplay = (cm: number | null | undefined): number | null => {
    if (cm == null) return null;
    return unit === 'in' ? Math.round((cm / CM_PER_IN) * 100) / 100 : cm;
  };
  const fromDisplay = (display: number | null): number | null => {
    if (display == null) return null;
    return unit === 'in' ? Math.round(display * CM_PER_IN * 100) / 100 : display;
  };

  const focusPoint = (key: MeasurementKey) => {
    setActiveKey(key);
    inputRefs.current[key]?.focus();
    fieldRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockEnd: 8 }}>
        <Segmented
          size="small"
          value={unit}
          onChange={(v) => setUnit(v as Unit)}
          options={[
            { value: 'cm', label: 'cm' },
            { value: 'in', label: 'in' },
          ]}
        />
      </div>

      <Row gutter={[24, 16]}>
        <Col xs={24} lg={9} xl={7}>
          <div style={{ position: 'sticky', top: 12 }}>
            <svg
              viewBox="0 0 320 400"
              style={{ width: '100%', maxWidth: 300 }}
              aria-label={isTrousers ? 'Trousers measurement diagram' : 'Robe measurement diagram'}
            >
              {isTrousers ? <TrousersOutline /> : <RobeOutline />}

              {/* Dimension-line arrows for every width/circumference/length point that has one */}
              {points.map((point) => {
                const spot = hotspots[point.key];
                if (!spot?.span) return null;
                return <DimensionLine key={`span-${point.key}`} {...spot.span} />;
              })}

              {/* Leader lines from each label to where it's actually measured on the body */}
              {points.map((point) => {
                const spot = hotspots[point.key];
                if (!spot) return null;
                return (
                  <g key={`leader-${point.key}`}>
                    <line
                      x1={spot.x}
                      y1={spot.y}
                      x2={spot.targetX}
                      y2={spot.targetY}
                      stroke="#90A4AE"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <circle cx={spot.targetX} cy={spot.targetY} r="2.5" fill="#00695C" />
                  </g>
                );
              })}

              {points.map((point) => {
                const spot = hotspots[point.key];
                if (!spot) return null;
                const filled = values[point.key] != null;
                const active = activeKey === point.key;
                return (
                  <g
                    key={point.key}
                    onClick={() => focusPoint(point.key)}
                    style={{ cursor: 'pointer' }}
                    role="button"
                    aria-label={`${point.code} ${label(point)}`}
                  >
                    {active && (
                      <circle cx={spot.x} cy={spot.y} r="15" fill="none" stroke="#FFA000" strokeWidth="2.5" />
                    )}
                    <circle
                      cx={spot.x}
                      cy={spot.y}
                      r="12"
                      fill={active ? '#FFA000' : filled ? '#00695C' : '#FFFFFF'}
                      stroke={active ? '#FFA000' : '#00695C'}
                      strokeWidth="2"
                    />
                    <text
                      x={spot.x}
                      y={spot.y + 4}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="700"
                      fill={active || filled ? '#FFFFFF' : '#00695C'}
                    >
                      {point.code}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </Col>

        <Col xs={24} lg={15} xl={17}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            {points.map((point) => {
              const active = activeKey === point.key;
              const spot = hotspots[point.key];
              return (
                <div
                  key={point.key}
                  ref={(el) => {
                    fieldRefs.current[point.key] = el;
                  }}
                  style={{
                    border: active ? '1.5px solid #FFA000' : '1px solid #EEEEEE',
                    borderRadius: 8,
                    padding: 10,
                    background: active ? '#FFF8E1' : '#fff',
                    boxShadow: active ? '0 2px 8px rgba(255,160,0,0.15)' : 'none',
                    transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBlockEnd: 6 }}>
                    {spot && <PointThumbnail spot={spot} isTrousers={isTrousers} />}
                    <div style={{ fontSize: 12, color: '#757575', lineHeight: 1.3 }}>
                      <Tooltip title={`${point.en} — ${point.ar}`}>
                        <b
                          style={{ color: '#00695C', cursor: 'pointer' }}
                          onClick={() => focusPoint(point.key)}
                        >
                          {point.code}
                        </b>
                      </Tooltip>{' '}
                      {label(point)}
                    </div>
                  </div>
                  <InputNumber
                    ref={(el) => {
                      inputRefs.current[point.key] = el;
                    }}
                    value={toDisplay(values[point.key] ?? null)}
                    onChange={(v) => onChange(point.key, fromDisplay(v))}
                    onFocus={() => setActiveKey(point.key)}
                    disabled={readOnly}
                    min={0}
                    max={unit === 'in' ? 157.5 : 400}
                    step={unit === 'in' ? 0.25 : 0.5}
                    addonAfter={unit}
                    size="large"
                    style={{ width: '100%' }}
                    inputMode="decimal"
                  />
                </div>
              );
            })}
          </div>
        </Col>
      </Row>
    </div>
  );
}
