import { useEffect, useState } from 'react';

// ============================================================================
// El QR de un cupón
// ============================================================================
// Para pegar en el mostrador, en el espejo o en un volante. Apunta al mismo
// link que el botón de copiar: `/:slug?cupon=CORTE20`. No hay nada que
// administrar — un QR no es una entidad, es una forma de escribir una URL.
//
// La librería se importa de forma DIFERIDA, adentro del efecto. Si estuviera
// arriba del archivo entraría en el chunk del panel y se la bajaría todo el
// mundo, incluido el barbero que nunca abre esta pantalla. Así se descarga
// recién cuando alguien toca "Ver QR".

export default function QrDelCupon({ link, codigo }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(link, {
        width: 512,
        margin: 2,
        // Negro sobre blanco y nada más: un QR con los colores de la marca se
        // ve lindo en pantalla y falla en la impresora de la barbería. El
        // contraste es lo único que hace que un teléfono lo lea de lejos.
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }))
      .then((url) => { if (vigente) setDataUrl(url); })
      .catch((err) => {
        console.error('[qr] No se pudo generar:', err);
        if (vigente) setError('No se pudo generar el QR.');
      });
    return () => { vigente = false; };
  }, [link]);

  if (error) return <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!dataUrl) return <p className="text-sm text-muted">Generando el QR…</p>;

  return (
    <div className="cupon-qr">
      <img src={dataUrl} alt={`QR del cupón ${codigo}`} />
      <div className="cupon-qr-acciones">
        {/* `download` con el código en el nombre: el dueño baja tres QR y
            necesita saber cuál es cuál sin abrirlos. */}
        <a className="btn btn-sm btn-outline" href={dataUrl} download={`qr-${codigo}.png`}>
          Descargar PNG
        </a>
        <span className="text-sm text-muted">Imprimilo y pegalo en el mostrador.</span>
      </div>
    </div>
  );
}
