import { faltanVariables } from '../lib/firebase';

/**
 * Pantalla de diagnóstico cuando el build salió sin la configuración de
 * Firebase. Existe porque el modo de falla anterior era una pantalla en blanco
 * sin ninguna pista: el error solo aparecía en la consola del navegador.
 *
 * Pasa típicamente en Vercel: `.env` está en .gitignore (bien, tiene el client
 * secret), así que las variables hay que cargarlas aparte en el panel. Vite las
 * congela en tiempo de compilación, así que no alcanza con agregarlas: hay que
 * volver a desplegar.
 */
export default function ConfigErrorPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-lg)',
        background: 'var(--bg)',
      }}
    >
      <div className="card" style={{ maxWidth: 560, padding: 'var(--space-xl)' }}>
        <span className="eyebrow">• Error de configuración</span>
        <h1 style={{ margin: '10px 0 var(--space-md)' }}>Falta la configuración de Firebase</h1>

        <p className="text-secondary" style={{ fontSize: 14, lineHeight: 1.6 }}>
          La app compiló sin las variables de entorno, así que no puede conectarse
          a la base de datos.
        </p>

        <div className="notice notice-danger" style={{ margin: 'var(--space-md) 0' }}>
          <strong>Variables que faltan:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {faltanVariables.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>

        <h3 style={{ marginTop: 'var(--space-lg)' }}>Cómo se arregla</h3>
        <ol
          className="text-secondary"
          style={{ fontSize: 13.5, lineHeight: 1.75, paddingLeft: 18, marginTop: 8 }}
        >
          <li>
            <strong>En Vercel:</strong> Settings → Environment Variables. Cargá cada
            una con su valor (están en tu <code>.env</code> local).
          </li>
          <li>
            <strong>Volvé a desplegar.</strong> Vite congela estas variables al
            compilar, así que agregarlas no alcanza: hace falta un build nuevo.
          </li>
          <li>
            <strong>En local:</strong> copiá <code>.env.example</code> como{' '}
            <code>.env</code> y completá los valores.
          </li>
        </ol>

        <p className="text-muted" style={{ fontSize: 12, marginTop: 'var(--space-lg)' }}>
          Estas claves son públicas por diseño: viajan en el bundle y no protegen
          nada. Lo que protege los datos son las Security Rules.
        </p>
      </div>
    </div>
  );
}
