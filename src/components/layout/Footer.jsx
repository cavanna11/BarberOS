export default function Footer() {
  return (
    <footer className="footer">
      {/* BarberOS es el producto; SACIA es el estudio que lo desarrolla. */}
      <img src="/img/barberos-logo-icon.svg" alt="BarberOS Logo" width="20" height="20" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
      <span className="footer-brand">BarberOS</span>
      <span className="footer-sep">·</span>
      <span>
        por <strong>SACIA</strong>
      </span>
      <span className="footer-sep">·</span>
      <span>{new Date().getFullYear()}</span>
    </footer>
  );
}
