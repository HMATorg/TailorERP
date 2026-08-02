import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * Code128 rather than a QR for garment tags: the cheap USB/Bluetooth 1D
 * scanners common on a workshop floor read Code128 reliably at the small
 * print size a fabric tag allows; not all of them read 2D symbologies at all.
 * Workshop's own scan input (`GET /workshop/tickets/by-code/:code`) just
 * matches the decoded text, so the symbology printed here is independent of
 * what it means downstream.
 */
export default function Barcode({
  value,
  height = 36,
  fontSize = 12,
  width = 2,
}: {
  value: string;
  height?: number;
  fontSize?: number;
  /** Narrow-bar (module) width in px — JsBarcode's own default is 2. */
  width?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      height,
      fontSize,
      width,
      margin: 2,
      displayValue: true,
    });
  }, [value, height, fontSize, width]);

  return <svg ref={ref} />;
}
