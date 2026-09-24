'use client';

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { budgetRows } from '@/lib/marketing';

export function StrategySummary({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const allocation = budgetRows(5000);
  return <>
    <div className="section-heading">
      <div><p className="eyebrow">EXECUTIVE SUMMARY</p><h2>Store opening strategy</h2>
        <p className="section-description">Build local awareness, drive store and Shopify sales, and turn new collectors into repeat customers.</p>
      </div>
      <span className="tag blue">$5,000 budget ask</span>
    </div>
    <div className="summary-grid">
      <section className="panel strategy-main">
        <div className="summary-heading"><span className="step-number">01</span><h3>The approach</h3></div>
        <p>Focus paid advertising on Facebook, Instagram and Google local search. Support it with store updates, product highlights, Boomski clips and the weekly <strong>Northside Locks</strong> series featuring three staff picks.</p>
        <p>Use email, the Northside app and our custom loyalty program to encourage repeat visits. Repurpose organic content for TikTok, X and Snapchat.</p>
        <div className="summary-heading"><span className="step-number">02</span><h3>The launch window</h3></div>
        <p>Run a rolling 30 day campaign: <strong>15 days before opening, opening day and 14 days after.</strong> The checklist’s Store Opens milestone anchors the campaign. Confirm the store address and offer before ads launch.</p>
        <div className="timeline-compact">
          <div><b>Before opening</b><span>Store previews and opening updates.</span></div>
          <div><b>Opening week</b><span>Local ads, clear directions and a reason to visit.</span></div>
          <div><b>After opening</b><span>New arrivals, customer stories and loyalty reminders.</span></div>
        </div>
        <div className="summary-heading"><span className="step-number">03</span><h3>Card shows and app growth</h3></div>
        <p>Have Northside and Hobby Key ready for the November Geneva show. Use separate tracked QR codes for Northside customers and prospective Hobby Key vendors. Repeat this at other shows; promote Northside’s own late January show separately. Show dates remain to be confirmed.</p>
      </section>
      <aside className="summary-side">
        <section className="panel">
          <h3>The investment</h3><div className="summary-budget">$5,000<span>Total media ceiling</span></div>
          <div className="budget-bar" role="img" aria-label="Budget allocation: Meta discovery 35%, Meta warm audience 20%, Google search 30%, optional test 5%, held reserve 10%">{allocation.map(row => <div key={row.name} style={{width:`${row.amount / 50}%`,background:row.color}} />)}</div>
          <div className="budget-lines">{allocation.map(row => <div key={row.name}><span><i style={{background:row.color}}/>{row.name}</span><b>${row.amount.toLocaleString()}</b></div>)}</div>
          <p className="muted">Production and software are separate. Shift a small warm audience budget to discovery; release the $500 reserve only when results justify it.</p>
        </section>
        <section className="panel decision-panel">
          <h3>Decisions needed</h3>
          <ul className="plain-list"><li>Approve the $5,000 media ceiling.</li><li>Confirm the store address and opening offer.</li><li>Confirm app readiness and show dates.</li></ul>
          <p className="muted">Steven leads execution and reporting. Joey approves spending and the launch offer; the team supplies content and store updates.</p>
        </section>
      </aside>
    </div>
    <section className="panel success-panel">
      <div><h3>How we will measure success</h3><p>Track sales, app signups, leads and cost per acquisition. Review weekly and move spending toward what produces results.</p></div>
      <div className="success-metrics"><div><b>1,400–4,700</b><span>Paid landing sessions</span></div><div><b>40–330</b><span>New opt ins</span></div><div><b>10–93</b><span>Online orders</span></div></div>
      <p className="muted">Illustrative planning ranges on $4,250 in Meta and Google spend, not promised results. Store sales and app signups are tracked separately. Use tagged links, placement specific QR codes and Shopify online/POS sales; keep platform attribution totals separate.</p>
      <Button variant="outline" onClick={() => onNavigate('performance')}>Open results dashboard<ArrowRight size={16}/></Button>
    </section>
  </>;
}
