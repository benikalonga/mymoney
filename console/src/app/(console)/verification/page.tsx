'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useResource, when } from '@/lib/api';
import { Badge, Empty, Header, Loading, Notice, ReasonAction } from '@/lib/ui';

export default function VerificationPage() {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useResource<any[]>(`/admin/kyc?status=${status}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const decide = (id: string, decision: string, reason?: string) => api(`/admin/kyc/${id}`, 'POST', { decision, reason }).then(reload);
  return (
    <>
      <Header title="Identity verification" sub="Approving a customer raises them to tier 2.">
        <select aria-label="Status" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}><option>pending</option><option>approved</option><option>rejected</option></select>
      </Header>
      <Notice error={error ?? actionError} />
      {!data ? <Loading /> : data.length === 0 ? <div className="card"><Empty text={`No ${status} verifications.`} /></div> : (
        <div className="grid g2">
          {data.map((k) => (
            <article key={k.id} className="card">
              <div className="row between"><h2 style={{ margin: 0 }}><Link className="link" href={`/customers/${k.userId}`}>{k.customerName}</Link></h2><Badge value={k.status} /></div>
              <dl className="kv mt">
                <dt>Legal name</dt><dd>{k.legalName}</dd><dt>Date of birth</dt><dd>{k.dateOfBirth}</dd><dt>Document</dt><dd>{k.documentType.replace(/_/g, ' ')}: <span className="mono">{k.documentNumber}</span></dd>
                <dt>Address</dt><dd>{k.address}</dd><dt>Phone</dt><dd>{k.phone}</dd><dt>Submitted</dt><dd>{when(k.createdAt)}</dd>
                {k.reason && <><dt>Reason</dt><dd>{k.reason}</dd></>}
              </dl>
              {k.status === 'pending' && (
                <div className="row end mt">
                  <ReasonAction danger label="Reject" prompt="What should the customer fix? They will see this." onConfirm={(r) => decide(k.id, 'rejected', r)} />
                  <button className="btn primary" onClick={() => { setActionError(null); decide(k.id, 'approved').catch((e: Error) => setActionError(e.message)); }}>Approve</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
