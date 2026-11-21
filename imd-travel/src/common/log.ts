export function log(
  event: string,
  cid: string,
  ms: number,
  extra?: Record<string, unknown>,
) {
  const entry = {
    ts: new Date().toISOString(),
    svc: 'imdtravel',
    cid,
    event,
    ms,
    ...extra,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}
