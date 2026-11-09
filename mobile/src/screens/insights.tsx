import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Chips, Empty, ErrorText, Line, Muted, Row, Screen, SectionTitle, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { money, titleCase } from '../lib/format';
import { colors } from '../theme';

function lastMonths() {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < 6; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

export function InsightsScreen() {
  const months = lastMonths();
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api(`/insights?month=${month}`).then((d) => { setData(d); setError(null); }, (e: Error) => setError(e.message));
  useEffect(() => { setData(null); void load(); }, [month]);
  const total = data?.sentUsd || 1;
  return (
    <Screen title="Insights" onRefresh={load}>
      <Chips options={months} value={month} onChange={setMonth} label={monthName} />
      <ErrorText text={error} />
      {!data ? (!error && <Spinner />) : (
        <>
          <Card>
            <Muted>Amounts are shown in US dollars.</Muted>
            <Line label="Sent" value={money(data.sentUsd, 'USD')} strong />
            <Line label="Received" value={money(data.receivedUsd, 'USD')} />
            <Line label="Added" value={money(data.addedUsd, 'USD')} />
          </Card>
          <SectionTitle>By category</SectionTitle>
          <Card>
            {data.byCategory.length === 0 ? <Empty icon="pie-chart-outline" text="Nothing sent this month." /> : data.byCategory.map((c: any) => (
              <View key={c.category} style={{ gap: 4, marginBottom: 6 }}>
                <Line label={titleCase(c.category)} value={money(c.usd, 'USD')} />
                <View style={{ height: 8, backgroundColor: colors.brandSoft, borderRadius: 4, overflow: 'hidden' }}><View style={{ height: 8, width: `${(c.usd / total) * 100}%`, backgroundColor: colors.brand }} /></View>
              </View>
            ))}
          </Card>
          {data.topRecipients.length > 0 && <SectionTitle>Top recipients</SectionTitle>}
          {data.topRecipients.length > 0 && <Card style={{ gap: 0 }}>{data.topRecipients.map((r: any) => <Row key={r.name} icon="person-outline" title={r.name} sub={`${r.count} payment${r.count === 1 ? '' : 's'}`} right={<Text style={{ fontWeight: '700', color: colors.ink }}>{money(r.usd, 'USD')}</Text>} />)}</Card>}
        </>
      )}
    </Screen>
  );
}
