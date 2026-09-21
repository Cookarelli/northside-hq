import {BarChart3} from 'lucide-react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {EmptyState,SectionHeader,StatCard} from '@/components/hq-ui';
import {reportingSources,type MetricRow} from '@/lib/hq-sections';
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
export function HqReporting({rows,unavailable,onAdd}:{rows:MetricRow[];unavailable:boolean;onAdd:()=>void}) {
 const sources=reportingSources(rows),totals=sources.reduce((s,r)=>({spend:s.spend+r.spend,revenue:s.revenue+r.revenue,orders:s.orders+r.orders,leads:s.leads+r.leads}),{spend:0,revenue:0,orders:0,leads:0});
 const maximum=Math.max(1,...sources.flatMap(s=>[s.revenue,s.spend]));
 const value=(n:number,currency=false)=>unavailable||!rows.length?'—':currency?money(n):n.toLocaleString('en-US');
 return <><div className="hq-stat-grid"><StatCard label="Ad Spend" value={value(totals.spend,true)} description="From recorded reporting rows"/><StatCard label="Tracked Revenue" value={value(totals.revenue,true)} description="Online + POS net sales"/><StatCard label="Orders" value={value(totals.orders)} description="Online + POS orders"/><StatCard label="Leads" value={value(totals.leads)} description="Recorded opt-ins"/></div>
 <section className="panel"><SectionHeader title="Performance by source" description="Actual entered results for the selected dates" action={<Link href="/projects#tracking">Tracked Links</Link>}/>{unavailable?<p role="status">Reporting data is unavailable until the workspace loads successfully.</p>:!rows.length?<EmptyState icon={BarChart3} title="No results recorded for this view" description="Add reconciled reporting data to understand spend, sales and customer response." action={<Button onClick={onAdd}>Add Results</Button>}/>:<div className="hq-source-results">{sources.map(s=><article key={s.source}><div className="hq-source-result-title"><h3>{s.source}</h3><span>{s.orders} orders · {s.leads} leads</span></div><div className="hq-result-bar"><span>Revenue</span><div role="img" aria-label={s.source+' tracked revenue '+money(s.revenue)}><i style={{width:s.revenue/maximum*100+'%'}}/></div><b>{money(s.revenue)}</b></div><div className="hq-result-bar is-spend"><span>Ad spend</span><div role="img" aria-label={s.source+' ad spend '+money(s.spend)}><i style={{width:s.spend/maximum*100+'%'}}/></div><b>{money(s.spend)}</b></div></article>)}</div>}</section></>;
}
