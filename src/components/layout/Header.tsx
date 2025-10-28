'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import ConsoleDownloadButton from '@/components/ConsoleDownloadButton';
import { mainNavigation } from '@/config/navigation';

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleCloseMenu = () => {
    setMobileMenuOpen(false);
  };

  const toggleMenu = () => {
    setMobileMenuOpen(prev => !prev);
  };

  return (
    <header className="site-header">
      <div className="layout-container site-header__inner">
        <div className="site-brand">
          <Link href="/" className="site-brand__title">
            Nexus
          </Link>
          <p className="site-brand__subtitle">Docs / Tasks workspace</p>
        </div>
        <button
          type="button"
          className="site-header__toggle"
          onClick={toggleMenu}
          aria-expanded={mobileMenuOpen}
          aria-controls="site-navigation"
        >
          {mobileMenuOpen ? '閉じる' : 'メニュー'}
        </button>
        <nav
          id="site-navigation"
          className={`site-nav${mobileMenuOpen ? ' is-open' : ''}`}
          aria-label="メインナビゲーション"
        >
          <ul className="site-nav__list">
            {mainNavigation.map(item => (
              <li key={item.href} className="site-nav__item">
                {item.external ? (
                  <a
                    href={item.href}
                    className="site-nav__link"
                    target="_blank"
                    rel="noreferrer"
                    onClick={handleCloseMenu}
                  >
                    {item.label}
                  </a>
                ) : item.href.startsWith('#') ? (
                  <a href={item.href} className="site-nav__link" onClick={handleCloseMenu}>
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className="site-nav__link" onClick={handleCloseMenu}>
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="site-header__actions">
            <ConsoleDownloadButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
