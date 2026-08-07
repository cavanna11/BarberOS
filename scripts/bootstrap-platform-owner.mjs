/**
 * ============================================================================
 * Alta del primer dueño de plataforma (se corre UNA sola vez)
 * ============================================================================
 *
 * Problema del huevo y la gallina: `setBusinessAdmin` exige el claim
 * `platform: true` para funcionar, pero nadie lo tiene todavía. Este script
 * rompe ese círculo desde afuera, con la service account.
 *
 * PASOS
 *
 * 1. Entrá UNA VEZ a la app con Google usando tu cuenta, para que Firebase Auth
 *    cree tu usuario. Sin eso el script no te encuentra.
 *
 * 2. Bajá la service account:
 *      Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio
 *      → "Generar nueva clave privada"
 *    Guardala como `serviceAccountKey.json` en la raíz del proyecto.
 *    Ese archivo da acceso TOTAL al proyecto y ya está en .gitignore.
 *    Borralo cuando termines.
 *
 * 3. Corré:
 *      node scripts/bootstrap-platform-owner.mjs tu-email@gmail.com
 *
 * 4. Cerrá sesión en la app y volvé a entrar, para que el token traiga el claim.
 *
 * 5. Borrá `serviceAccountKey.json`.
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error('Uso: node scripts/bootstrap-platform-owner.mjs tu-email@gmail.com');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
} catch {
  console.error(
    'No encontré ./serviceAccountKey.json.\n' +
    'Bajalo de: Firebase Console → Configuración del proyecto → Cuentas de servicio.'
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

try {
  const user = await getAuth().getUserByEmail(email);

  await getAuth().setCustomUserClaims(user.uid, { platform: true });

  console.log(`\n✅ ${email} es dueño de la plataforma.`);
  console.log(`   UID: ${user.uid}`);
  console.log('\nAhora:');
  console.log('  1. Cerrá sesión en la app y volvé a entrar (el token viejo no tiene el claim).');
  console.log('  2. Borrá serviceAccountKey.json.\n');
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    console.error(
      `\nNo existe ningún usuario con ${email}.\n` +
      'Entrá una vez a la app con Google usando esa cuenta y volvé a correr esto.\n'
    );
  } else {
    console.error('\nError:', err.message, '\n');
  }
  process.exit(1);
}
