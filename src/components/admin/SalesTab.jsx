import { useEffect, useMemo, useRef } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Chart from 'chart.js/auto';

function RevenueIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" /><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.4 6 4.3 0 1.4-1.3 2.4-3 2.4s-3-1-3-2.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  );
}

function OrdersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 3h12l1 5H5l1-5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><path d="M9 11.5v3M15 11.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  );
}

// null = not enough data for a meaningful comparison (both days empty).
// isNew = today has activity but yesterday had none — a % change would be
// infinite/undefined, so that gets its own "new today" badge instead.
const MEDALS = ['🥇', '🥈', '🥉'];

function trendFor(today, yesterday) {
  if (today === 0 && yesterday === 0) return null;
  if (yesterday === 0) return { isNew: true };
  return { pct: Math.round(((today - yesterday) / yesterday) * 100) };
}

function TrendBadge({ trend }) {
  if (!trend) return null;
  if (trend.isNew) return <span className="trend-badge trend-up">🌱 new today</span>;
  const up = trend.pct >= 0;
  return <span className={`trend-badge ${up ? 'trend-up' : 'trend-down'}`}>{up ? '▲' : '▼'} {Math.abs(trend.pct)}% vs yesterday</span>;
}

export default function SalesTab() {
  const { orders } = useMoocha();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // Revenue/best-sellers/etc. should only ever reflect money actually in
  // hand — 'Refunded' gave it back, and 'Payment failed' never collected
  // it in the first place (the checkout session just expired unpaid).
  // 'Received' and 'Collected' are the two states reachable only once
  // payment genuinely succeeded (see canRefund in OrderDetailSheet).
  // Memoized so the chart-rebuild effect below only re-fires when `orders`
  // itself actually changes, not on every render (a fresh .filter() result
  // is a new array reference each time, which would otherwise destroy and
  // recreate the Chart.js instance far more often than needed).
  const paidOrders = useMemo(
    () => orders.filter(o => o.status === 'Received' || o.status === 'Collected'),
    [orders]
  );

  const revenue = paidOrders.reduce((s, o) => s + o.total, 0);
  const avg = paidOrders.length ? revenue / paidOrders.length : 0;
  const itemCounts = {};
  paidOrders.forEach(o => o.items.forEach(i => { itemCounts[i.name] = (itemCounts[i.name] || 0) + i.qty; }));
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const uniqueCustomers = new Set(paidOrders.map(o => o.phone).filter(Boolean)).size;

  // Today-vs-yesterday trend for the two primary KPIs — a separate,
  // smaller comparison from the all-time totals shown as the card's
  // headline number, so it reads as "today's pace" rather than implying
  // the whole running total moved by this %.
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let todayRevenue = 0, yesterdayRevenue = 0, todayOrders = 0, yesterdayOrders = 0;
  paidOrders.forEach(o => {
    const day = o.date.slice(0, 10);
    if (day === todayKey) { todayRevenue += o.total; todayOrders += 1; }
    else if (day === yesterdayKey) { yesterdayRevenue += o.total; yesterdayOrders += 1; }
  });
  const revenueTrend = trendFor(todayRevenue, yesterdayRevenue);
  const ordersTrend = trendFor(todayOrders, yesterdayOrders);

  useEffect(() => {
    if (!canvasRef.current) return;
    const byDay = {};
    paidOrders.forEach(o => { const day = o.date.slice(0, 10); byDay[day] = (byDay[day] || 0) + o.total; });
    // A real trailing-N-calendar-day window (today back N-1 days), not just
    // "the last N days that happen to have an order" — otherwise a slow
    // stretch with gaps renders as if the bars were contiguous days. N
    // shrinks for a shop that hasn't been trading a full week yet (down to
    // a 3-day floor) instead of always drawing 7 columns where only the
    // last one or two ever have a bar in them.
    const earliestDay = paidOrders.length
      ? paidOrders.reduce((min, o) => { const d = o.date.slice(0, 10); return d < min ? d : min; }, paidOrders[0].date.slice(0, 10))
      : null;
    const daysOfHistory = earliestDay
      ? Math.floor((Date.now() - new Date(earliestDay + 'T00:00:00').getTime()) / 86400000) + 1
      : 3;
    const rangeDays = Math.min(7, Math.max(3, daysOfHistory));
    const days = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (rangeDays - 1 - i));
      return d.toISOString().slice(0, 10);
    });
    const data = days.map(d => byDay[d] || 0);
    const labels = days.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data,
          backgroundColor: '#85A573',
          borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => money(ctx.parsed.y) } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [paidOrders]);

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card primary">
          <div className="stat-card-head"><RevenueIcon /><div className="stat-label">Total revenue</div></div>
          <div className="stat-num">{money(revenue)}</div>
          <TrendBadge trend={revenueTrend} />
        </div>
        {/* Matches paidOrders (not orders.length) so "revenue ÷ orders" on
            this card actually reconciles with the avg order value card
            right next to it, instead of counting failed/refunded attempts
            that revenue itself already excludes. */}
        <div className="stat-card primary">
          <div className="stat-card-head"><OrdersIcon /><div className="stat-label">Orders</div></div>
          <div className="stat-num">{paidOrders.length}</div>
          <TrendBadge trend={ordersTrend} />
        </div>
        <div className="stat-card"><div className="stat-num">{money(avg)}</div><div className="stat-label">Avg order value</div></div>
        <div className="stat-card"><div className="stat-num">{uniqueCustomers}</div><div className="stat-label">Unique customers</div></div>
      </div>
      <div className="chart-card">
        <div className="card-heading">Revenue by day</div>
        <canvas ref={canvasRef} height="160" />
      </div>
      <div className="chart-card">
        <div className="card-heading">Top items</div>
        {topItems.length
          ? topItems.map(([name, qty], i) => (
            <div className="top-item-row" key={name}>
              <span className="top-item-left">
                <span className={`rank-badge ${i < 3 ? 'medal' : ''}`}>{i < 3 ? MEDALS[i] : i + 1}</span>
                {name}
              </span>
              <span>{qty} sold</span>
            </div>
          ))
          : <div className="section-note">No orders yet.</div>}
      </div>
    </>
  );
}
