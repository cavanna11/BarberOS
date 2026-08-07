// Configuración del tema White-Label
// Estos valores se cargan desde business_settings y se aplican como CSS custom properties.
//
// Los defaults son la identidad de SACIA (sacia.tech): naranja quemado sobre
// casi-blanco. Cada barbería puede pisar primary/secondary/accent con sus
// propios colores desde /admin/configuracion; el resto es la base del producto.
// Los mismos valores están en :root de index.css — si cambiás uno, cambiá el otro.

export const defaultTheme = {
  primaryColor: '#e03d00',
  primaryHover: '#b83200',
  primaryLight: '#fdf0eb',
  secondaryColor: '#ff5c1a',
  accentColor: '#ff5c1a',
  bgColor: '#fafafa',
  surfaceColor: '#ffffff',
  textColor: '#0a0a0a',
  textSecondary: '#555555',
  textMuted: '#aaaaaa',
  borderColor: 'rgba(0, 0, 0, 0.08)',
  successColor: '#0f9960',
  warningColor: '#b45309',
  dangerColor: '#d92d20',
};

export function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--primary', theme.primaryColor || defaultTheme.primaryColor);
  root.style.setProperty('--primary-hover', theme.primaryHover || defaultTheme.primaryHover);
  root.style.setProperty('--primary-light', theme.primaryLight || defaultTheme.primaryLight);
  root.style.setProperty('--secondary', theme.secondaryColor || defaultTheme.secondaryColor);
  root.style.setProperty('--accent', theme.accentColor || defaultTheme.accentColor);
}
