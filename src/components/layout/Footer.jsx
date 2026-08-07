export default function Footer() {
  return (
    <footer className="footer">
      {/* BarberOS es el producto; SACIA es el estudio que lo desarrolla. */}
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
