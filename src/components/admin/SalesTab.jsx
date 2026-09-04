import React, { useEffect, useMemo, useRef } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Chart from 'chart.js/auto';

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

  useEffect(() => {
    if (!canvasRef.current) return;
    const byDay = {};
    paidOrders.forEach(o => { const day = o.date.slice(0, 10); byDay[day] = (byDay[day] || 0) + o.total; });
    // A real trailing 7-calendar-day window (today back 6 days), not just
    // "the last 7 days that happen to have an order" — otherwise a slow
    // stretch with gaps renders as if the bars were contiguous days.
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const data = days.map(d => byDay[d] || 0);
    const labels = days.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Revenue ($)', data, backgroundColor: '#85A573', borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
    return () => chartRef.current?.destroy();
  }, [paidOrders]);

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num">{money(revenue)}</div><div className="stat-label">Total revenue</div></div>
        {/* Matches paidOrders (not orders.length) so "revenue ÷ orders" on
            this card actually reconciles with the avg order value card
            right next to it, instead of counting failed/refunded attempts
            that revenue itself already excludes. */}
        <div className="stat-card"><div className="stat-num">{paidOrders.length}</div><div className="stat-label">Orders</div></div>
        <div className="stat-card"><div className="stat-num">{money(avg)}</div><div className="stat-label">Avg order value</div></div>
        <div className="stat-card"><div className="stat-num">{uniqueCustomers}</div><div className="stat-label">Unique customers</div></div>
      </div>
      <div className="chart-card"><canvas ref={canvasRef} height="160" /></div>
      <div className="chart-card">
        <div className="card-heading">Top items</div>
        {topItems.length
          ? topItems.map(([name, qty]) => <div className="top-item-row" key={name}><span>{name}</span><span>{qty} sold</span></div>)
          : <div className="section-note">No orders yet.</div>}
      </div>
    </>
  );
}
