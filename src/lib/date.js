// <input type="date"> gives/wants "YYYY-MM-DD" in local time — shared by
// OrdersTab's single-day filter and SalesTab's date-range filter.
export function toLocalDateStr(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
