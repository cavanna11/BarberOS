import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Firebase pesa más que todo el código de la app junta y casi nunca
        // cambia. En un chunk aparte, el navegador lo cachea entre despliegues
        // en vez de volver a bajarlo con cada cambio de una pantalla.
        manualChunks: {
          // Listar un módulo acá lo mete en el bundle aunque nadie lo importe:
          // `firebase/storage` estaba entrando por esta puerta. Agregarlo de
          // nuevo recién cuando algo lo use.
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
