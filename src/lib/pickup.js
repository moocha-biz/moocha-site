export function formatCollectionWindow(start, end) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  const dateFmt = { weekday: 'short', day: 'numeric', month: 'short' };
  const timeFmt = { hour: 'numeric', minute: '2-digit' };
  const sameDay = s.toDateString() === e.toDateString();
  const startStr = `${s.toLocaleDateString(undefined, dateFmt)}, ${s.toLocaleTimeString(undefined, timeFmt)}`;
  const endStr = sameDay ? e.toLocaleTimeString(undefined, timeFmt) : `${e.toLocaleDateString(undefined, dateFmt)}, ${e.toLocaleTimeString(undefined, timeFmt)}`;
  return `${startStr} – ${endStr}`;
}
