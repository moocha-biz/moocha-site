// Shared between OrdersTab (list rows) and OrderDetailSheet (header) so an
// order's status reads the same color at a glance in both places, instead
// of the list using a flat mint pill for every status while the detail
// view color-codes it.
export const STATUS_STYLE = {
  'Received': { background: 'var(--sun)', color: '#8a5b05' },
  'Collected': { background: 'var(--green)', color: '#fff' },
  'Refunded': { background: 'var(--blush)', color: '#8a3a2a' },
  'Payment failed': { background: 'var(--blush-deep)', color: '#fff' },
};

export function Badge({ style, label }) {
  return (
    <span style={{
      ...style, fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
      textTransform: 'uppercase', letterSpacing: '0.02em', display: 'inline-block',
    }}>{label}</span>
  );
}

export default function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] || { background: 'var(--mint)', color: 'var(--green-dark)' };
  return <Badge style={style} label={status} />;
}
