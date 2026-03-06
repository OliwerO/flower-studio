// SourceChart — donut chart showing order distribution by source channel.
// Like a Pareto chart for your sales channels: which ones generate volume?

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import t from '../translations.js';

const COLORS = ['#db2777', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#8E8E93'];

export default function SourceChart({ bySource, revenueBySource }) {
  const chartData = Object.entries(bySource)
    .map(([name, value]) => ({
      name,
      orders: value,
      revenue: revenueBySource?.[name] || 0,
    }))
    .sort((a, b) => b.orders - a.orders);

  if (chartData.length === 0) return null;

  return (
    <div className="glass-card px-4 py-4">
      <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
        {t.bySource}
      </h3>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="orders"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, props) => [`${value} orders`, name]}
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
            />
            <Legend
              formatter={(value) => <span className="text-xs">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue table per source */}
      {Object.keys(revenueBySource || {}).length > 0 && (
        <div className="mt-3 space-y-1">
          {chartData.map((item, i) => (
            <div key={item.name} className="flex items-center justify-between text-xs py-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="text-ios-label">{item.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-ios-tertiary">{item.orders} orders</span>
                {item.revenue > 0 && (
                  <span className="font-medium text-ios-label">{item.revenue.toFixed(0)} {t.zl}</span>
                )}
                {item.orders > 0 && item.revenue > 0 && (
                  <span className="text-ios-tertiary">avg {(item.revenue / item.orders).toFixed(0)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
