import { createContext, useContext, useReducer, useEffect, useState } from 'react';
import * as seed from '../config/seedData';
import { LEGACY_BUSINESS_ID } from '../config/platform';

/** Estado inicial de una instalación limpia. */
function emptyState() {
  return {
    business: seed.businessSettings,
    businesses: [...seed.businesses],
    currentBusinessId: null,
    professionals: [...seed.professionals],
    services: [...seed.services],
    professionalServices: [...seed.professionalServices],
    schedules: [...seed.schedules],
    appointments: [...seed.appointments],
    authorizedAdmins: [...seed.authorizedAdmins],
    whatsappConfig: { ...seed.whatsappConfig },
    whatsappLogs: [...seed.whatsappLogs],
  };
}

const BusinessContext = createContext();

const STORAGE_KEY = 'barberos_data';

/**
 * Datos guardados antes de la multi-tenancy pueden no tener `businessId`.
 * Sin esto, al filtrar por tenant esos registros desaparecerían de la UI.
 * Los adoptamos para el negocio original.
 */
function stampLegacyBusinessId(rows = []) {
  // Ojo: se chequea la presencia de la clave, no su valor. Los dueños de
  // plataforma llevan `businessId: null` a propósito (no pertenecen a un tenant).
  return rows.map((row) =>
    'businessId' in row ? row : { ...row, businessId: LEGACY_BUSINESS_ID }
  );
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}

function saveData(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

const _saved = loadData();

// Lo guardado manda; el seed vacío solo aporta las claves que falten (bases
// creadas con versiones anteriores) y el estado de una instalación nueva.
const initialState = _saved
  ? {
      ...emptyState(),
      ..._saved,
      currentBusinessId: _saved.currentBusinessId || _saved.business?.id || null,
      professionals: stampLegacyBusinessId(_saved.professionals),
      services: stampLegacyBusinessId(_saved.services),
      appointments: stampLegacyBusinessId(_saved.appointments),
      authorizedAdmins: stampLegacyBusinessId(_saved.authorizedAdmins),
    }
  : emptyState();

function businessReducer(state, action) {
  switch (action.type) {
    // ── Citas ──────────────────────────────────────────────────────────────
    case 'ADD_APPOINTMENT':
      return { ...state, appointments: [...state.appointments, action.payload] };
    case 'UPDATE_APPOINTMENT':
      return {
        ...state,
        appointments: state.appointments.map((a) =>
          a.id === action.payload.id ? { ...a, ...action.payload } : a
        ),
      };
    case 'CANCEL_APPOINTMENT':
      return {
        ...state,
        appointments: state.appointments.map((a) =>
          a.id === action.payload
            ? { ...a, status: 'cancelada', cancelledAt: new Date().toISOString() }
            : a
        ),
      };

    // ── Profesionales ──────────────────────────────────────────────────────
    case 'ADD_PROFESSIONAL':
      return { ...state, professionals: [...state.professionals, action.payload] };
    case 'UPDATE_PROFESSIONAL':
      return {
        ...state,
        professionals: state.professionals.map((p) =>
          p.id === action.payload.id ? { ...p, ...action.payload } : p
        ),
      };
    case 'DELETE_PROFESSIONAL':
      return {
        ...state,
        professionals: state.professionals.filter((p) => p.id !== action.payload),
        schedules: state.schedules.filter((s) => s.professionalId !== action.payload),
        professionalServices: state.professionalServices.filter((ps) => ps.professionalId !== action.payload),
      };

    // ── Servicios ──────────────────────────────────────────────────────────
    case 'ADD_SERVICE':
      return { ...state, services: [...state.services, action.payload] };
    case 'UPDATE_SERVICE':
      return {
        ...state,
        services: state.services.map((s) =>
          s.id === action.payload.id ? { ...s, ...action.payload } : s
        ),
      };
    case 'DELETE_SERVICE':
      return {
        ...state,
        services: state.services.filter((s) => s.id !== action.payload),
      };

    // ── Horarios / Professional-Services ───────────────────────────────────
    case 'SET_SCHEDULES':
      return {
        ...state,
        schedules: [
          ...state.schedules.filter((s) => s.professionalId !== action.payload.professionalId),
          ...action.payload.schedules,
        ],
      };
    // Reasigna, para un servicio, qué profesionales lo prestan.
    // (El caso espejo de UPDATE_PROFESSIONAL_SERVICES, que va por profesional.)
    case 'SET_SERVICE_PROFESSIONALS':
      return {
        ...state,
        professionalServices: [
          ...state.professionalServices.filter(
            (ps) => ps.serviceId !== action.payload.serviceId
          ),
          ...action.payload.assignments,
        ],
      };
    case 'UPDATE_PROFESSIONAL_SERVICES':
      return {
        ...state,
        professionalServices: [
          ...state.professionalServices.filter(
            (ps) => ps.professionalId !== action.payload.professionalId
          ),
          ...action.payload.services,
        ],
      };

    // ── Configuración del negocio ──────────────────────────────────────────
    case 'UPDATE_BUSINESS': {
      const updatedBusiness = { ...state.business, ...action.payload };
      return {
        ...state,
        business: updatedBusiness,
        businesses: state.businesses.map((b) =>
          b.id === updatedBusiness.id ? updatedBusiness : b
        ),
      };
    }

    // ── Admins autorizados ─────────────────────────────────────────────────
    case 'ADD_AUTHORIZED_ADMIN':
      return {
        ...state,
        authorizedAdmins: [...state.authorizedAdmins, action.payload],
      };
    case 'UPDATE_AUTHORIZED_ADMIN':
      return {
        ...state,
        authorizedAdmins: state.authorizedAdmins.map((a) =>
          a.id === action.payload.id ? { ...a, ...action.payload } : a
        ),
      };
    case 'REMOVE_AUTHORIZED_ADMIN':
      return {
        ...state,
        authorizedAdmins: state.authorizedAdmins.filter((a) => a.id !== action.payload),
      };

    // ── Tenant activo ──────────────────────────────────────────────────────
    // Cambia cuál es el negocio sobre el que operan las lecturas y escrituras.
    case 'SET_CURRENT_BUSINESS': {
      const target = (state.businesses || []).find((b) => b.id === action.payload);
      if (!target) return state;
      return { ...state, currentBusinessId: target.id, business: target };
    }

    // ── Alta de un negocio nuevo (onboarding manual) ───────────────────────
    // Crea el tenant y, en la misma operación, deja al dueño de la barbería
    // como admin `owner` de ese tenant. Van juntos a propósito: un negocio sin
    // dueño no lo puede administrar nadie.
    case 'CREATE_BUSINESS': {
      const { business, ownerAdmin } = action.payload;
      return {
        ...state,
        businesses: [...state.businesses, business],
        authorizedAdmins: ownerAdmin
          ? [...state.authorizedAdmins, ownerAdmin]
          : state.authorizedAdmins,
        // El negocio recién creado queda como activo, listo para configurarlo.
        currentBusinessId: business.id,
        business,
      };
    }

    // ── Super-Admin Actions ────────────────────────────────────────────────
    case 'SET_BUSINESSES': {
      const activeBusiness = state.business
        ? action.payload.find((b) => b.id === state.business.id) || state.business
        : state.business;
      return { ...state, businesses: action.payload, business: activeBusiness };
    }
    case 'TOGGLE_FREEZE_BUSINESS': {
      const businesses = state.businesses.map((b) =>
        b.id === action.payload ? { ...b, isFrozen: !b.isFrozen } : b
      );
      const activeBusiness = state.business && state.business.id === action.payload
        ? { ...state.business, isFrozen: !state.business.isFrozen }
        : state.business;
      return { ...state, businesses, business: activeBusiness };
    }
    case 'UPDATE_BUSINESS_DEBT': {
      const { businessId, debt } = action.payload;
      const businesses = state.businesses.map((b) =>
        b.id === businessId ? { ...b, debt } : b
      );
      const activeBusiness = state.business && state.business.id === businessId
        ? { ...state.business, debt }
        : state.business;
      return { ...state, businesses, business: activeBusiness };
    }
    case 'RECORD_BUSINESS_PAYMENT': {
      const { businessId, amount, date } = action.payload;
      const businesses = state.businesses.map((b) => {
        if (b.id === businessId) {
          const newDebt = Math.max(0, b.debt - amount);
          return {
            ...b,
            debt: newDebt,
            lastPaymentDate: date,
            isFrozen: newDebt > 0 ? b.isFrozen : false, // Reactivar automáticamente al saldar toda la deuda
          };
        }
        return b;
      });
      const activeBusiness = state.business && state.business.id === businessId
        ? businesses.find((b) => b.id === businessId)
        : state.business;
      return { ...state, businesses, business: activeBusiness };
    }
    case 'UPDATE_GLOBAL_WHATSAPP':
      return {
        ...state,
        whatsappConfig: { ...state.whatsappConfig, ...action.payload },
      };
    case 'UPGRADE_BUSINESS_PLAN': {
      const { businessId, planId, whatsappQuota, monthlyFee } = action.payload;
      const changes = { planId, whatsappQuota, monthlyFee };
      const businesses = state.businesses.map((b) =>
        b.id === businessId ? { ...b, ...changes } : b
      );
      const activeBusiness = state.business && state.business.id === businessId
        ? { ...state.business, ...changes }
        : state.business;
      return { ...state, businesses, business: activeBusiness };
    }
    case 'ADD_WHATSAPP_LOG':
      return {
        ...state,
        whatsappLogs: [action.payload, ...state.whatsappLogs],
      };

    // ── Vaciar la base ─────────────────────────────────────────────────────
    // Borra TODO: negocios, staff, servicios, turnos y credenciales.
    // Antes restauraba datos de demostración; ahora deja la base en cero.
    case 'RESET_DATA':
      return emptyState();

    default:
      return state;
  }
}

export function BusinessProvider({ children }) {
  const [state, dispatch] = useReducer(businessReducer, initialState);
  const [billingChecked, setBillingChecked] = useState(false);

  // Motor de facturación automático (ejecutado una vez por sesión en local).
  // Con la base vacía no hay nada que facturar.
  useEffect(() => {
    if (billingChecked || !state.businesses?.length) return;

    const today = new Date().toISOString().split('T')[0];
    let updated = false;

    const newBusinesses = state.businesses.map((b) => {
      const biz = { ...b };
      let changed = false;

      // Inicializar fecha de cobro si no tiene
      if (!biz.nextBillingDate) {
        const createdDate = biz.createdAt ? new Date(biz.createdAt) : new Date();
        const nextDate = new Date(createdDate.setMonth(createdDate.getMonth() + 1));
        biz.nextBillingDate = nextDate.toISOString().split('T')[0];
        changed = true;
      }

      // Si se superó la fecha de vencimiento sin pagar
      while (today > biz.nextBillingDate) {
        // Sumar mensualidad a la deuda acumulada
        biz.debt = (biz.debt || 0) + (biz.monthlyFee || 0);
        // Desplazar fecha al mes siguiente
        const currentNext = new Date(biz.nextBillingDate + 'T00:00:00');
        currentNext.setMonth(currentNext.getMonth() + 1);
        biz.nextBillingDate = currentNext.toISOString().split('T')[0];
        changed = true;
      }

      // Suspensión automática: si tiene deuda, congelar
      if ((biz.debt || 0) > 0 && !biz.isFrozen) {
        biz.isFrozen = true;
        changed = true;
      }

      // Reactivación automática: si no tiene deuda y estaba congelado por deuda, descongelar
      if ((biz.debt || 0) === 0 && biz.isFrozen) {
        biz.isFrozen = false;
        changed = true;
      }

      if (changed) {
        updated = true;
      }
      return biz;
    });

    setBillingChecked(true);

    if (updated) {
      dispatch({ type: 'SET_BUSINESSES', payload: newBusinesses });
    }
  }, [state.businesses, billingChecked]);

  useEffect(() => {
    saveData(state);
  }, [state]);

  return (
    <BusinessContext.Provider value={{ state, dispatch }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness must be used within BusinessProvider');
  return context;
}
