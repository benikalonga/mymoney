'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight, BadgeCheck, LayoutDashboard, LogOut, Moon, Percent, ScrollText, UserCog, Users } from 'lucide-react';
import { getToken, setToken, useResource } from '@/lib/api';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
  }, [router]);
  if (!ready) return null;
  return <Shell path={path}>{children}</Shell>;
}

function Shell({ path, children }: { path: string; children: ReactNode }) {
  const router = useRouter();
  const { data: me } = useResource('/admin/me');
  const { data: stats } = useResource('/admin/overview', 15_000);
  const nav = [
    { href: '/', label: 'Overview', Icon: LayoutDashboard },
    { href: '/transactions', label: 'Transactions', Icon: ArrowLeftRight, count: stats?.reviewQueue },
    { href: '/customers', label: 'Customers', Icon: Users },
    { href: '/verification', label: 'Verification', Icon: BadgeCheck, count: stats?.kycPending },
    { href: '/pricing', label: 'Rates & fees', Icon: Percent },
    { href: '/audit', label: 'Audit log', Icon: ScrollText },
    ...(me?.role === 'owner' ? [{ href: '/team', label: 'Team', Icon: UserCog }] : []),
  ];
  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('mymoney.theme', root.dataset.theme); } catch { /* the theme just will not be remembered */ }
  };
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo"><i>M</i> MyMoney</div>
        {nav.map(({ href, label, Icon, count }) => (
          <Link key={href} href={href} className={`nav ${(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''}`}>
            <Icon size={17} /> {label} {count ? <em>{count}</em> : null}
          </Link>
        ))}
        <div className="side-foot">
          {me && <div style={{ padding: '4px 10px 8px' }}>{me.name}<br /><span style={{ opacity: .65, textTransform: 'capitalize' }}>{me.role}</span></div>}
          <button onClick={toggleTheme}><Moon size={16} /> Switch theme</button>
          <button onClick={() => { setToken(null); router.replace('/login'); }}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
