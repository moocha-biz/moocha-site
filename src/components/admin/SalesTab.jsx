import React, { useEffect, useRef } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Chart from 'chart.js/auto';

export default function SalesTab() {
  const { orders } = useMoocha();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const avg = orders.length ? revenue / orders.length : 0;
  const itemCounts = {};
  orders.forEach(o => o.items.forEach(i => { itemCounts[i.name] = (itemCounts[i.name] || 0) + i.qty; }));
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  useEffect(() => {
    if (!canvasRef.current) return;
    const byDay = {};
    orders.forEach(o => { const day = o.date.slice(0, 10); byDay[day] = (byDay[day] || 0) + o.total; });
    const days = Object.keys(byDay).sort().slice(-7);
    const data = days.map(d => byDay[d]);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels: days.length ? days : ['No data'], datasets: [{ label: 'Revenue ($)', data: data.length ? data : [0], backgroundColor: '#85A573', borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
    return () => chartRef.current?.destroy();
  }, [orders]);

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num">{money(revenue)}</div><div className="stat-label">Total revenue</div></div>
        <div className="stat-card"><div className="stat-num">{orders.length}</div><div className="stat-label">Orders</div></div>
        <div className="stat-card"><div className="stat-num">{money(avg)}</div><div className="stat-label">Avg order value</div></div>
        <div className="stat-card"><div className="stat-num">{new Set(orders.map(o => o.phone)).size}</div><div className="stat-label">Unique customers</div></div>
      </div>
      <div className="chart-card"><canvas ref={canvasRef} height="160" /></div>
      <div className="chart-card">
        <div style={{ fontFamily: "'Baloo 2'", fontWeight: 700, marginBottom: 8 }}>Top items</div>
        {topItems.length
          ? topItems.map(([name, qty]) => <div className="top-item-row" key={name}><span>{name}</span><span>{qty} sold</span></div>)
          : <div style={{ fontSize: 13, color: 'var(--brand)' }}>No orders yet.</div>}
      </div>
    </>
  );
}
