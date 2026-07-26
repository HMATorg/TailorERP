/**
 * Fires N simultaneous POS checkouts at ONE fabric roll and checks the
 * invariants that only break under contention:
 *
 *   1. No oversell — reserved must never exceed what is physically on the roll,
 *      and the roll must never be taken below its minimum usable point.
 *   2. No lost updates — reserved_quantity must equal the sum of live
 *      reservations, not a value clobbered by a concurrent writer.
 *   3. ZATCA ICV must be unique and gap-free — a duplicate counter or a hole is
 *      a compliance failure, and the allocation runs under FOR UPDATE.
 *   4. Order numbers must be unique per store.
 */
const B = 'http://localhost:3000/api/v1';
const P = 'Tailonix@Dev1';
const CONCURRENCY = Number(process.env.N ?? 12);

const j = async (r) => {
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};

(async () => {
  const login = (await j(await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@alanwar.example', password: P }),
  }))).body;
  const store = login.stores.find((s) => !s.isHeadquarters);
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken, 'X-Store-Id': store.id };

  const customer = (await j(await fetch(B + '/customers', { headers: H }))).body.items[0];
  const rolls = (await j(await fetch(B + '/inventory/sellable?requiredMeters=4', { headers: H }))).body;
  if (!rolls.length) { console.error('no sellable roll'); process.exit(1); }
  const roll = rolls[0];

  const before = (await j(await fetch(B + `/inventory/batches/${roll.id}`, { headers: H }))).body;
  const startQty = Number(before.currentQuantity);
  const startReserved = Number(before.reservedQuantity);
  const minUsable = Number(before.minUsableMeters);
  const yieldPer = Number((await j(await fetch(
    `${B}/pos/customers/${customer.id}/yield?garmentType=Thobe&quantity=1`, { headers: H }))).body.perGarment);

  // Deliberately size the roll so only SOME requests can succeed — that is the
  // only configuration where a race actually shows up.
  const capacity = Math.floor((startQty - startReserved - minUsable) / yieldPer);
  console.log(`roll ${roll.batchCode}: ${startQty}m, reserved ${startReserved}m, min ${minUsable}m`);
  console.log(`yield ${yieldPer}m/garment → capacity ${capacity} garments; firing ${CONCURRENCY} concurrent checkouts\n`);

  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(B + '/pos/orders', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          customerId: customer.id,
          items: [{ garmentType: 'Thobe', fabricBatchId: roll.id, unitPrice: 400 }],
        }),
      }).then(j),
    ),
  );
  const elapsed = Date.now() - t0;

  const ok = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status === 422);
  const errors = results.filter((r) => ![201, 422].includes(r.status));

  console.log(`accepted ${ok.length}  rejected-422 ${rejected.length}  other ${errors.length}  in ${elapsed}ms`);
  if (errors.length) console.log('  unexpected:', JSON.stringify(errors[0]).slice(0, 300));

  const after = (await j(await fetch(B + `/inventory/batches/${roll.id}`, { headers: H }))).body;
  const endQty = Number(after.currentQuantity);
  const endReserved = Number(after.reservedQuantity);

  console.log(`\nroll after: ${endQty}m current, ${endReserved}m reserved`);

  const checks = [];
  checks.push(['accepted never exceeds capacity', ok.length <= capacity, `${ok.length} <= ${capacity}`]);
  checks.push(['reserved matches accepted x yield',
    Math.abs(endReserved - (startReserved + ok.length * yieldPer)) < 0.005,
    `${endReserved} vs ${(startReserved + ok.length * yieldPer).toFixed(2)}`]);
  checks.push(['reserved never exceeds current', endReserved <= endQty, `${endReserved} <= ${endQty}`]);
  checks.push(['roll stays above minimum', endQty - endReserved >= minUsable - 0.005,
    `${(endQty - endReserved).toFixed(2)} >= ${minUsable}`]);
  checks.push(['no unexpected errors', errors.length === 0, `${errors.length}`]);

  const nums = ok.map((r) => r.body.orderNumber);
  checks.push(['order numbers unique', new Set(nums).size === nums.length, `${new Set(nums).size}/${nums.length}`]);

  const icvs = ok.map((r) => r.body.invoice?.icv).filter((v) => v != null);
  checks.push(['ICVs unique', new Set(icvs).size === icvs.length, `${new Set(icvs).size}/${icvs.length}`]);
  // Every accepted order MUST carry a tax invoice — a missing one is a
  // compliance failure, not a degraded response.
  checks.push(['every order got a tax invoice', icvs.length === ok.length,
    `${icvs.length}/${ok.length}`]);

  const compliance = (await j(await fetch(B + '/zatca/compliance', { headers: H }))).body;
  checks.push(['ZATCA chain intact', compliance.chainIntact === true, String(compliance.chainIntact)]);
  checks.push(['no ICV gaps', (compliance.icvGaps ?? []).length === 0, JSON.stringify(compliance.icvGaps)]);

  const tb = (await j(await fetch(B + '/ledger/trial-balance', { headers: H }))).body;
  checks.push(['ledger still balances', tb.balanced === true, `${tb.totalDebit}/${tb.totalCredit}`]);

  console.log('');
  let failed = 0;
  for (const [name, pass, detail] of checks) {
    if (!pass) failed++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
  }
  console.log(failed ? `\n${failed} INVARIANT(S) VIOLATED` : '\nall invariants held');
  process.exit(failed ? 1 : 0);
})();
