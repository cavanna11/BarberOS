import { useMemo } from 'react';
import { variablesDelTema } from '../../config/theme';
import { puede, CAPACIDADES } from '../../config/plans';

/**
 * Pone los colores de la barbería alrededor de lo que envuelve.
 *
 * `display: contents` a propósito: el div no genera caja, así que no cambia
 * NADA del layout de lo que está adentro —ni si el padre es flex, ni si el
 * hijo esperaba ser el primer elemento del flujo—, pero las custom properties
 * siguen heredando por el árbol del DOM, que es todo lo que hace falta.
 *
 * Los colores propios son del Plan Full. Si la cuenta no los tiene, esto no
 * declara ninguna variable y se ve el naranja de BarberOS: no hay que esconder
 * el componente ni poner un `if` en cada pantalla que lo use.
 */
export default function TemaNegocio({ business, children }) {
  const vars = useMemo(
    () => variablesDelTema(business, puede(business, CAPACIDADES.colores)),
    [business]
  );
  if (!Object.keys(vars).length) return children;
  return <div style={{ display: 'contents', ...vars }}>{children}</div>;
}
