import { footerNavigation } from '@/config/navigation';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="layout-container site-footer__inner">
        <div className="site-footer__brand">
          <span className="site-footer__title">Nexus</span>
          <p className="site-footer__description">
            Docs / Tasks workspace をより快適に利用できるようデザインされたインターフェースです。
          </p>
        </div>
        <div className="site-footer__meta">
          <span className="site-footer__copyright">© {year} Nexus AI</span>
          <ul className="site-footer__links">
            {footerNavigation.map(item => (
              <li key={item.href} className="site-footer__item">
                {item.external ? (
                  <a href={item.href} target="_blank" rel="noreferrer" className="site-footer__link">
                    {item.label}
                  </a>
                ) : (
                  <a href={item.href} className="site-footer__link">
                    {item.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
