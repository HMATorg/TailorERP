interface AlertRow {
  fabricName: string;
  currentQty: string;
  thresholdQty: string;
  suggestedOrderQty: string;
}

const SHELL = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;background:#FAFAFA;font-family:Inter,Arial,sans-serif;color:#212121">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#00695C;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
      <h1 style="margin:0;font-size:20px">Tailonix</h1>
    </div>
    <div style="background:#fff;padding:20px;border-radius:0 0 8px 8px">
      <h2 style="margin-top:0;font-size:17px;color:#00695C">${title}</h2>
      ${body}
    </div>
    <p style="color:#757575;font-size:12px;text-align:center;margin-top:16px">
      Sent by Tailonix. You receive this because you manage this store.
    </p>
  </div>
</body></html>`;

/** Daily low-stock digest (PRD I-5). */
export function lowStockDigest(storeName: string, alerts: AlertRow[]) {
  const rows = alerts
    .map(
      (a) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${a.fabricName}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#C62828"><b>${a.currentQty}</b></td>
        <td style="padding:8px;border-bottom:1px solid #eee">${a.thresholdQty}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><b>${a.suggestedOrderQty}</b></td>
      </tr>`,
    )
    .join('');

  const body = `
    <p>${alerts.length} fabric${alerts.length === 1 ? '' : 's'} at <b>${storeName}</b>
       ${alerts.length === 1 ? 'has' : 'have'} fallen to or below the reorder threshold.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="text-align:left;color:#757575;font-size:12px;text-transform:uppercase">
          <th style="padding:8px">Fabric</th><th style="padding:8px">In stock</th>
          <th style="padding:8px">Threshold</th><th style="padding:8px">Suggested order</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return {
    subject: `Low stock: ${alerts.length} fabric${alerts.length === 1 ? '' : 's'} at ${storeName}`,
    html: SHELL('Daily stock alert', body),
    text: `Low stock at ${storeName}:\n${alerts
      .map((a) => `- ${a.fabricName}: ${a.currentQty} left (threshold ${a.thresholdQty}), order ${a.suggestedOrderQty}`)
      .join('\n')}`,
  };
}

/** Staff invitation with the accept link (HQ-4). */
export function staffInvitation(params: {
  organizationName: string;
  inviterName: string;
  acceptUrl: string;
  roleSummary: string;
}) {
  const body = `
    <p><b>${params.inviterName}</b> invited you to join <b>${params.organizationName}</b> on Tailonix as
       ${params.roleSummary}.</p>
    <p style="margin:24px 0">
      <a href="${params.acceptUrl}"
         style="background:#00695C;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block">
        Accept invitation
      </a>
    </p>
    <p style="color:#757575;font-size:13px">This link expires in 7 days.</p>`;

  return {
    subject: `${params.inviterName} invited you to ${params.organizationName} on Tailonix`,
    html: SHELL('You have been invited', body),
    text: `${params.inviterName} invited you to join ${params.organizationName} as ${params.roleSummary}.\nAccept: ${params.acceptUrl}\nThis link expires in 7 days.`,
  };
}
