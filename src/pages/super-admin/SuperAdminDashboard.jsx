import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import TeamPanel from './TeamPanel';
import { PLANS, OVERAGE_COST_USD, findPlanByQuota } from '../../config/plans';
import { formatPrice, formatDate } from '../../utils/dateUtils';
import {
  setBusinessFrozen,
  recordPayment,
  updateBilling,
  upgradePlan,
  savePlatformConfig,
} from '../../lib/repository';
import NewBusinessModal from './NewBusinessModal';
import TicketsPanel from './TicketsPanel';

// --- Professional SVG Icons ---
const BusinessIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
);

const ActiveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
);

const SuspendedIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);

const RevenueIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
);

const DebtIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
);

export default function SuperAdminDashboard() {
  const { state, dispatch } = useBusiness();
  const navigate = useNavigate();
  const { businesses, whatsappConfig, whatsappLogs, appointments, professionals, services } = state;

  const [activeTab, setActiveTab] = useState('resumen');

  // Un moderador entra al panel para VER y para atender soporte. Todo lo que
  // mueve plata, cuentas o suspensiones queda escondido. Esto es UI: la
  // barrera real son las Rules y las Cloud Functions, que le rechazan esas
  // operaciones aunque se las mande a mano.
  const { user } = useAuth();
  const soloLectura = Boolean(user?.isModerator);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewBusiness, setShowNewBusiness] = useState(false);

  // Modals
  const [modalType, setModalType] = useState(null); // 'payment' | 'debt' | 'upgrade'
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [debtAmount, setDebtAmount] = useState('');

  // Upgrade Plan fields
  const [selectedPlan, setSelectedPlan] = useState('basico');
  const [upgradeQuota, setUpgradeQuota] = useState('');
  const [upgradeFee, setUpgradeFee] = useState('');

  // WhatsApp Form
  const [waForm, setWaForm] = useState({
    phoneId: whatsappConfig?.phoneId || '',
    token: whatsappConfig?.token || '',
    templateConfirmation: whatsappConfig?.templateConfirmation || '',
    templateReminder: whatsappConfig?.templateReminder || '',
  });
  const [waSaved, setWaSaved] = useState(false);

  // Filters
  const [tenantStatusFilter, setTenantStatusFilter] = useState('all');
  const [tenantDebtFilter, setTenantDebtFilter] = useState('all');

  const [appointmentBusinessFilter, setAppointmentBusinessFilter] = useState('all');
  const [appointmentDateFilter, setAppointmentDateFilter] = useState('');

  const [logBusinessFilter, setLogBusinessFilter] = useState('all');
  const [logStatusFilter, setLogStatusFilter] = useState('all');
  const [logDateFilter, setLogDateFilter] = useState('');

  // --- Calculations ---
  const totalBusinesses = businesses?.length || 0;
  const activeCount = businesses?.filter(b => !b.isFrozen).length || 0;
  const suspendedCount = businesses?.filter(b => b.isFrozen).length || 0;
  const projectedRevenue = businesses?.reduce((sum, b) => sum + (b.monthlyFee || 0), 0) || 0;
  const totalDebt = businesses?.reduce((sum, b) => sum + (b.debt || 0), 0) || 0;

  // Monthly WhatsApp message counting helper
  const getCurrentMonthStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const currentMonthStr = getCurrentMonthStr();

  const getMonthlyMessageCount = (businessId) => {
    return whatsappLogs?.filter(log => 
      log.businessId === businessId && 
      log.status === 'sent' && 
      log.sentAt && 
      log.sentAt.startsWith(currentMonthStr)
    ).length || 0;
  };
  
  // WhatsApp stats
  const totalMsgs = whatsappLogs?.length || 0;
  const failedMsgs = whatsappLogs?.filter(l => l.status === 'failed').length || 0;
  const successMsgs = totalMsgs - failedMsgs;
  const failedPercentage = totalMsgs > 0 ? ((failedMsgs / totalMsgs) * 100).toFixed(1) : '0.0';

  // --- Handlers ---
  const handleToggleFreeze = async (id) => {
    const biz = businesses.find((b) => b.id === id);
    try {
      await setBusinessFrozen(id, !biz?.isFrozen);
    } catch (err) {
      console.error('[super-admin] No se pudo cambiar el estado:', err);
      alert('No se pudo cambiar el estado de la cuenta: ' + err.message);
    }
  };

  /**
   * Entra al panel del negocio como si fueras su dueño, para dejarle la cuenta
   * configurada (profesionales, servicios, horarios) antes de entregarla.
   */
  const handleManageBusiness = (businessId) => {
    dispatch({ type: 'SET_CURRENT_BUSINESS', payload: businessId });
    navigate('/admin');
  };

  const handleOpenPaymentModal = (biz) => {
    setSelectedBusiness(biz);
    setPaymentAmount(String(biz.debt ?? 0));
    setModalType('payment');
  };

  const handleOpenDebtModal = (biz) => {
    setSelectedBusiness(biz);
    setDebtAmount(String(biz.debt ?? 0));
    setModalType('debt');
  };

  const handleOpenUpgradeModal = (biz) => {
    setSelectedBusiness(biz);
    const plan = findPlanByQuota(biz.whatsappQuota);
    if (plan) {
      setSelectedPlan(plan.id);
    } else {
      setSelectedPlan('personalizado');
      setUpgradeQuota(String(biz.whatsappQuota ?? ''));
      setUpgradeFee(String(biz.monthlyFee ?? ''));
    }
    setModalType('upgrade');
  };

  const handleRecordPayment = async () => {
    if (!paymentAmount || isNaN(paymentAmount)) return;
    const todayStr = new Date().toISOString().split('T')[0];
    try {
      await recordPayment(selectedBusiness.id, Number(paymentAmount), todayStr);
    } catch (err) {
      console.error('[super-admin] No se pudo registrar el pago:', err);
      alert('No se pudo registrar el pago: ' + err.message);
      return;
    }
    dispatch({
      type: 'ADD_WHATSAPP_LOG',
      payload: {
        id: 'wlog-' + Date.now(),
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.name,
        recipient: selectedBusiness.phone,
        recipientName: selectedBusiness.name,
        type: 'Pago Registrado',
        status: 'sent',
        sentAt: new Date().toISOString(),
        message: `Hola ${selectedBusiness.name}, se ha registrado un pago de abono por un monto de ${formatPrice(Number(paymentAmount))}. ¡Gracias por confiar en BarberOS!`
      }
    });
    setModalType(null);
    setSelectedBusiness(null);
  };

  const handleEditDebt = async () => {
    if (debtAmount === '' || isNaN(debtAmount)) return;
    try {
      await updateBilling(selectedBusiness.id, { debt: Number(debtAmount) });
    } catch (err) {
      console.error('[super-admin] No se pudo actualizar el saldo:', err);
      alert('No se pudo actualizar el saldo: ' + err.message);
      return;
    }
    setModalType(null);
    setSelectedBusiness(null);
  };

  const handleRecordUpgrade = async () => {
    // Los planes vienen de src/config/plans.js; solo "personalizado" se escribe a mano.
    const plan = PLANS.find((p) => p.id === selectedPlan);
    const quota = plan ? plan.whatsappQuota : Number(upgradeQuota) || 0;
    const fee = plan ? plan.monthlyFee : Number(upgradeFee) || 0;
    const planLabel = plan ? plan.label : 'Plan Personalizado';

    try {
      await upgradePlan(selectedBusiness.id, {
        planId: plan ? plan.id : 'personalizado',
        whatsappQuota: quota,
        monthlyFee: fee,
      });
    } catch (err) {
      console.error('[super-admin] No se pudo cambiar el plan:', err);
      alert('No se pudo cambiar el plan: ' + err.message);
      return;
    }

    dispatch({
      type: 'ADD_WHATSAPP_LOG',
      payload: {
        id: 'wlog-' + Date.now(),
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.name,
        recipient: selectedBusiness.phone || '+54 11 9999-9999',
        recipientName: selectedBusiness.name,
        type: 'Plan Actualizado',
        status: 'sent',
        sentAt: new Date().toISOString(),
        message: `Hola ${selectedBusiness.name}, tu plan ha sido actualizado a ${planLabel}. Nueva cuota: ${quota} mensajes/mes, abono mensual: ${formatPrice(fee)}.`
      }
    });

    setModalType(null);
    setSelectedBusiness(null);
  };

  const handleSaveWhatsApp = async (e) => {
    e.preventDefault();
    try {
      // Va a /platform/whatsapp, que solo puede leer y escribir la plataforma.
      // OJO: el token de Meta no debería vivir en Firestore ni en el browser.
      // Cuando se active el envío real, va como secret de Cloud Functions.
      await savePlatformConfig('whatsapp', waForm);
      setWaSaved(true);
      setTimeout(() => setWaSaved(false), 3000);
    } catch (err) {
      console.error('[super-admin] No se pudo guardar WhatsApp:', err);
      alert('No se pudo guardar la configuración: ' + err.message);
    }
  };

  const filteredBusinesses = businesses?.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          b.slug.toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesStatus = true;
    if (tenantStatusFilter === 'active') matchesStatus = !b.isFrozen;
    if (tenantStatusFilter === 'frozen') matchesStatus = b.isFrozen;

    let matchesDebt = true;
    if (tenantDebtFilter === 'debt') matchesDebt = (b.debt || 0) > 0;
    if (tenantDebtFilter === 'no_debt') matchesDebt = (b.debt || 0) === 0;

    return matchesSearch && matchesStatus && matchesDebt;
  }) || [];

  const filteredAppointments = [...(appointments || [])]
    .filter(apt => {
      const matchesBusiness = appointmentBusinessFilter === 'all' || apt.businessId === appointmentBusinessFilter;
      const matchesDate = !appointmentDateFilter || apt.appointmentDate === appointmentDateFilter;
      return matchesBusiness && matchesDate;
    })
    .sort((a, b) => {
      const da = a.appointmentDate + 'T' + a.startTime;
      const db = b.appointmentDate + 'T' + b.startTime;
      return db.localeCompare(da);
    });

  const filteredLogs = (whatsappLogs || [])
    .filter(log => {
      const matchesBusiness = logBusinessFilter === 'all' || log.businessId === logBusinessFilter;
      const matchesStatus = logStatusFilter === 'all' || log.status === logStatusFilter;
      const matchesDate = !logDateFilter || (log.sentAt && log.sentAt.startsWith(logDateFilter));
      return matchesBusiness && matchesStatus && matchesDate;
    });

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      
      {/* Page Header */}
      <div className="admin-page-header" style={{ marginBottom: 'var(--space-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Panel Global</span>
          </h1>
          <span className="text-secondary text-sm">Control de establecimientos, facturación y automatización.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {soloLectura && (
            <span className="badge badge-warning">Moderador · solo lectura y soporte</span>
          )}
          {!soloLectura && (
            <button
              onClick={() => setShowNewBusiness(true)}
              className="btn btn-primary"
              style={{ fontSize: 13, padding: '9px 16px' }}
            >
              + Nueva barbería
            </button>
          )}
          {/* Se quitó "Vaciar base": los datos ya no están en este navegador.
              Borrar la base ahora afecta a clientes reales y se hace desde la
              consola de Firebase, a conciencia — no con un botón al lado del
              de dar de alta. */}
        </div>
      </div>

      {/* Tabs Menu */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-color)', paddingBottom: 1, marginBottom: 'var(--space-lg)', overflowX: 'auto' }}>
        <button 
          onClick={() => setActiveTab('resumen')}
          className={`btn ${activeTab === 'resumen' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Resumen Plataforma
        </button>
        <button 
          onClick={() => setActiveTab('tenants')}
          className={`btn ${activeTab === 'tenants' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Gestionar Barberías ({totalBusinesses})
        </button>
        <button 
          onClick={() => setActiveTab('citas')}
          className={`btn ${activeTab === 'citas' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Monitoreo de Turnos ({appointments?.length || 0})
        </button>
        {!soloLectura && (<>
        <button 
          onClick={() => setActiveTab('whatsapp')}
          className={`btn ${activeTab === 'whatsapp' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          API WhatsApp Cloud
        </button>
        <button 
          onClick={() => setActiveTab('logs')}
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Historial Mensajes ({totalMsgs})
        </button>
        </>)}
        <button
          onClick={() => setActiveTab('soporte')}
          className={`btn ${activeTab === 'soporte' ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Soporte
        </button>
        {!soloLectura && (
          <button
            onClick={() => setActiveTab('equipo')}
            className={`btn ${activeTab === 'equipo' ? 'btn-primary' : 'btn-outline'}`}
            style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            Equipo
          </button>
        )}
      </div>

      {activeTab === 'equipo' && !soloLectura && <TeamPanel />}

      {/* Base vacía: lo único que tiene sentido hacer es dar de alta el primer cliente */}
      {totalBusinesses === 0 && activeTab !== 'soporte' && activeTab !== 'equipo' && (
        <div className="card empty-state" style={{ padding: 'var(--space-2xl)' }}>
          <div className="empty-state-icon">💈</div>
          <h3 style={{ marginBottom: 8 }}>Todavía no hay ninguna barbería</h3>
          <p style={{ maxWidth: 460, margin: '0 auto var(--space-lg)' }}>
            Cuando cierres un cliente, dalo de alta acá: se crea su cuenta, su
            link público y el acceso del dueño en un solo paso.
          </p>
          <button onClick={() => setShowNewBusiness(true)} className="btn btn-primary">
            + Dar de alta la primera barbería
          </button>
        </div>
      )}

      {/* TAB 6: SOPORTE — bandeja de entrada de tickets */}
      {activeTab === 'soporte' && <TicketsPanel />}

      {/* TAB 1: RESUMEN GENERAL */}
      {totalBusinesses > 0 && activeTab === 'resumen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Stats Grid */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><BusinessIcon /></div>
              <div className="stat-card-value">{totalBusinesses}</div>
              <div className="stat-card-label">Establecimientos Totales</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--success-light)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><ActiveIcon /></div>
              <div className="stat-card-value">{activeCount}</div>
              <div className="stat-card-label">Suscripciones Activas</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><SuspendedIcon /></div>
              <div className="stat-card-value">{suspendedCount}</div>
              <div className="stat-card-label">Cuentas Suspendidas</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--bg-secondary)', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><RevenueIcon /></div>
              <div className="stat-card-value">{formatPrice(projectedRevenue)}</div>
              <div className="stat-card-label">Suscripción Mensual Proyectada</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DebtIcon /></div>
              <div className="stat-card-value" style={{ color: totalDebt > 0 ? 'var(--danger)' : 'inherit' }}>{formatPrice(totalDebt)}</div>
              <div className="stat-card-label">Deuda Total por Cobrar</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
            
            {/* Actividad Reciente WhatsApp */}
            <div className="card" style={{ padding: 'var(--space-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                <h3>Rendimiento WhatsApp API</h3>
                <span className="badge badge-success" style={{ fontSize: 11 }}>Conectado</span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)', background: 'var(--bg-secondary)', padding: 'var(--space-sm)', borderRadius: 8 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--success)' }}>{successMsgs}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Exitosos</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--danger)' }}>{failedMsgs}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Fallidos</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 24, fontWeight: 'bold' }}>{failedPercentage}%</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tasa de Falla</div>
                </div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                La API de WhatsApp Cloud se encarga de enviar las confirmaciones de turnos al instante y los recordatorios automáticos de forma unificada.
              </p>
            </div>

            {/* Ultimas Alertas */}
            <div className="card" style={{ padding: 'var(--space-md)' }}>
              <h3>Alertas del Sistema</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'var(--space-sm)' }}>
                {businesses?.filter(b => (b.debt || 0) > 0).map(b => (
                  <div 
                    key={b.id} 
                    style={{ 
                      padding: 10, 
                      borderRadius: 8, 
                      background: 'var(--warning-light)', 
                      borderLeft: '3px solid var(--warning)',
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>Deuda Pendiente: {b.name}</span>
                      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>Abono mensual vencido.</div>
                    </div>
                    <span style={{ fontWeight: 'bold', color: 'var(--danger)', fontSize: 13 }}>{formatPrice(b.debt)}</span>
                  </div>
                ))}
                {suspendedCount > 0 && (
                  <div 
                    style={{ 
                      padding: 10, 
                      borderRadius: 8, 
                      background: 'var(--danger-light)', 
                      borderLeft: '3px solid var(--danger)',
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger)' }}>Establecimientos Suspendidos</span>
                      <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Hay salones con el acceso congelado por falta de pago.</div>
                    </div>
                    <span className="badge badge-danger">{suspendedCount} suspendidos</span>
                  </div>
                )}
                {/* Alerta de Cuota WhatsApp Excedida */}
                {businesses?.map(b => {
                  const sentCount = getMonthlyMessageCount(b.id);
                  if (sentCount > (b.whatsappQuota || 0)) {
                    const extraCount = sentCount - b.whatsappQuota;
                    const extraCostUSD = extraCount * OVERAGE_COST_USD;
                    return (
                      <div 
                        key={`quota-alert-${b.id}`} 
                        style={{ 
                          padding: 10, 
                          borderRadius: 8, 
                          background: 'var(--danger-light)', 
                          borderLeft: '3px solid var(--danger)',
                          display: 'flex', 
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger)' }}>Cuota Excedida: {b.name}</span>
                          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
                            Consumo: {sentCount}/{b.whatsappQuota} mensajes.
                            <span style={{ display: 'block', fontWeight: 600, color: 'var(--danger)', marginTop: 2 }}>
                              Extra: {extraCount} mensajes (+USD {extraCostUSD.toFixed(2)})
                            </span>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleOpenUpgradeModal(b)}
                          className="btn btn-danger" 
                          style={{ background: 'var(--danger)', color: '#fff', fontSize: '11px', padding: '4px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Ofrecer Upgrade
                        </button>
                      </div>
                    );
                  }
                  return null;
                })}
                {businesses?.filter(b => (b.debt || 0) === 0 && !b.isFrozen).length === totalBusinesses && 
                 !businesses?.some(b => getMonthlyMessageCount(b.id) > (b.whatsappQuota || 0)) && (
                  <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                    <p>No hay alertas financieras ni de consumo pendientes. Todos los abonos están al día.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 2: TENANTS LIST */}
      {totalBusinesses > 0 && activeTab === 'tenants' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {/* Filters card */}
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Gestionar Barberías y Salones</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setShowNewBusiness(true)}
                  className="btn btn-primary"
                  style={{ margin: 0, fontSize: 13 }}
                >
                  + Nueva barbería
                </button>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Buscar por nombre o slug..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ margin: 0, width: 220 }}
                />
                <select
                  className="form-input"
                  value={tenantStatusFilter}
                  onChange={e => setTenantStatusFilter(e.target.value)}
                  style={{ margin: 0, width: 140 }}
                >
                  <option value="all">Todos los Estados</option>
                  <option value="active">Activos</option>
                  <option value="frozen">Suspendidos</option>
                </select>
                <select
                  className="form-input"
                  value={tenantDebtFilter}
                  onChange={e => setTenantDebtFilter(e.target.value)}
                  style={{ margin: 0, width: 140 }}
                >
                  <option value="all">Todas las Deudas</option>
                  <option value="debt">Con Deuda</option>
                  <option value="no_debt">Sin Deuda</option>
                </select>
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: 'var(--space-md)'
          }}>
            {filteredBusinesses.map(b => {
              const sentCount = getMonthlyMessageCount(b.id);
              const isExceeded = sentCount > (b.whatsappQuota || 0);
              const quotaPercentage = Math.min(100, (sentCount / (b.whatsappQuota || 1)) * 100);

              return (
                <div key={b.id} className="card" style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 'var(--space-md)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface)',
                  padding: 'var(--space-md)',
                  position: 'relative',
                  overflow: 'hidden',
                  margin: 0
                }}>
                  {/* Decorative status top border */}
                  <div style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    right: 0, 
                    height: 4, 
                    background: b.isFrozen ? 'var(--danger)' : 'var(--success)' 
                  }} />

                  {/* Header: Name & Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
                    <div>
                      <strong style={{ fontSize: 16, color: 'var(--text)' }}>{b.name}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        URL: <span style={{ fontFamily: 'monospace', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>/{b.slug}</span>
                      </div>
                    </div>
                    <span className={`badge ${b.isFrozen ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: 11 }}>
                      {b.isFrozen ? 'Suspendido' : 'Activo'}
                    </span>
                  </div>

                  {/* WhatsApp usage meter */}
                  <div style={{ background: 'var(--bg-secondary)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Consumo WhatsApp</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isExceeded ? 'var(--danger)' : 'var(--text)' }}>
                        {sentCount} / {b.whatsappQuota}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ 
                        height: '100%', 
                        width: `${quotaPercentage}%`, 
                        background: isExceeded ? 'var(--danger)' : 'linear-gradient(90deg, var(--primary), var(--secondary))',
                        borderRadius: 3 
                      }} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                      <span>Mensajes enviados este mes</span>
                      {isExceeded && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>¡Límite excedido!</span>}
                    </div>

                    {isExceeded && (
                      <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--danger-light)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
                          +{sentCount - b.whatsappQuota} extra (+USD {((sentCount - b.whatsappQuota) * OVERAGE_COST_USD).toFixed(2)})
                        </span>
                        <button 
                          onClick={() => handleOpenUpgradeModal(b)}
                          className="badge badge-warning" 
                          style={{ fontSize: 10, padding: '2px 8px', border: 'none', cursor: 'pointer', background: 'var(--warning)', color: 'white' }}
                        >
                          Upgrade
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Financial Info Grid */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr', 
                    gap: '12px var(--space-md)',
                    borderTop: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                    padding: 'var(--space-md) 0'
                  }}>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Abono Mensual</span>
                      <strong style={{ fontSize: 14 }}>{formatPrice(b.monthlyFee)}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Deuda Acumulada</span>
                      <strong style={{ 
                        fontSize: 14, 
                        color: b.debt > 0 ? 'var(--danger)' : 'var(--success)'
                      }}>
                        {formatPrice(b.debt)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Último Pago</span>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>
                        {b.lastPaymentDate ? formatDate(b.lastPaymentDate).split(',')[1] : 'Ninguno'}
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Próximo Vencimiento</span>
                      <span style={{ 
                        fontSize: 13,
                        fontWeight: b.debt > 0 ? '600' : 'normal',
                        color: b.debt > 0 ? 'var(--danger)' : 'var(--text)'
                      }}>
                        {b.nextBillingDate ? formatDate(b.nextBillingDate).split(',')[1] : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginTop: 4
                  }}>
                    <button
                      onClick={() => handleManageBusiness(b.id)}
                      className="btn btn-primary"
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center', gridColumn: '1 / -1' }}
                    >
                      ⚙️ Administrar esta cuenta
                    </button>
                    <a
                      href={`/${b.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-outline"
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center', gridColumn: '1 / -1', textDecoration: 'none' }}
                    >
                      🔗 Ver link público
                    </a>
                    {!soloLectura && (<>
                    <button
                      onClick={() => handleToggleFreeze(b.id)}
                      className={`btn ${b.isFrozen ? 'btn-success' : 'btn-danger'}`}
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center' }}
                    >
                      {b.isFrozen ? '🟢 Habilitar' : '🔴 Suspender'}
                    </button>
                    <button 
                      onClick={() => handleOpenPaymentModal(b)}
                      className="btn btn-outline"
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center' }}
                    >
                      💵 Registrar Pago
                    </button>
                    <button 
                      onClick={() => handleOpenUpgradeModal(b)}
                      className="btn btn-outline"
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center' }}
                    >
                      🚀 Cambiar Plan
                    </button>
                    <button 
                      onClick={() => handleOpenDebtModal(b)}
                      className="btn btn-outline"
                      style={{ padding: '8px', fontSize: 12, justifyContent: 'center' }}
                    >
                      ✏️ Editar Saldo
                    </button>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredBusinesses.length === 0 && (
            <div className="card empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <p>No se encontraron establecimientos con los filtros aplicados.</p>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: GLOBAL APPOINTMENTS LOG */}
      {totalBusinesses > 0 && activeTab === 'citas' && (
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <div>
              <h3 style={{ margin: 0 }}>Monitoreo Global de Turnos</h3>
              <p className="text-secondary" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                Auditoría en tiempo real de todos los turnos agendados en la plataforma BarberOS.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select
                className="form-input"
                value={appointmentBusinessFilter}
                onChange={e => setAppointmentBusinessFilter(e.target.value)}
                style={{ margin: 0, width: 180 }}
              >
                <option value="all">Todas las Barberías</option>
                {businesses?.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="date"
                  className="form-input"
                  value={appointmentDateFilter}
                  onChange={e => setAppointmentDateFilter(e.target.value)}
                  style={{ margin: 0, width: 140 }}
                />
                {appointmentDateFilter && (
                  <button 
                    onClick={() => setAppointmentDateFilter('')}
                    className="btn btn-outline"
                    style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-secondary)', borderColor: 'var(--border-color)', margin: 0 }}
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha/Hora</th>
                <th>Establecimiento</th>
                <th>Profesional</th>
                <th>Cliente</th>
                <th>Servicio</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAppointments.map((apt) => {
                const biz = businesses?.find(b => b.id === apt.businessId);
                const prof = professionals?.find(p => p.id === apt.professionalId);
                const srv = services?.find(s => s.id === apt.serviceId);
                
                return (
                  <tr key={apt.id}>
                    <td>
                      <div>
                        <strong style={{ fontSize: 13 }}>{apt.startTime}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {formatDate(apt.appointmentDate).split(',')[1]}
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{biz?.name || '—'}</strong>
                    </td>
                    <td>
                      <span style={{ fontSize: 13 }}>{prof?.name || '—'}</span>
                    </td>
                    <td>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{apt.clientName || '—'}</span>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{apt.clientPhone || '—'}</div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 13 }}>{apt.type === 'walkin' ? 'Servicio sin turno' : (srv?.name || '—')}</span>
                    </td>
                    <td>
                      <strong>{formatPrice(apt.price)}</strong>
                    </td>
                    <td>
                      <span className={`badge ${
                        apt.status === 'completada' ? 'badge-primary' : 
                        apt.status === 'confirmada' ? 'badge-success' : 
                        apt.status === 'pendiente' ? 'badge-warning' : 'badge-danger'
                      }`}>
                        {apt.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!filteredAppointments || filteredAppointments.length === 0) && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
                    No se encontraron turnos con los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: WHATSAPP CONFIG */}
      {totalBusinesses > 0 && activeTab === 'whatsapp' && (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 'var(--space-lg)' }}>
          {/* Info Card */}
          <div className="card" style={{ padding: 'var(--space-md)', alignSelf: 'start' }}>
            <h3>Status API de WhatsApp</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: 'var(--success)', display: 'inline-block' }}></span>
              <strong style={{ color: 'var(--success)' }}>Meta Cloud API Conectada</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Las credenciales aquí configuradas se aplican de forma global para la entrega de confirmaciones y recordatorios de turnos automáticos.
            </p>
            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="text-muted">Mensajes hoy:</span>
                <strong>{successMsgs}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">Errores de envío:</span>
                <strong style={{ color: failedMsgs > 0 ? 'var(--danger)' : 'inherit' }}>{failedMsgs}</strong>
              </div>
            </div>
          </div>

          {/* Configuration Form */}
          <form onSubmit={handleSaveWhatsApp} className="card" style={{ padding: 'var(--space-md)' }}>
            <h3>Configuración Meta Cloud API</h3>
            
            {waSaved && (
              <div className="badge badge-success" style={{ display: 'block', padding: '8px 16px', marginBottom: 'var(--space-md)', borderRadius: 8 }}>
                Configuración de WhatsApp guardada exitosamente en la plataforma.
              </div>
            )}

            <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
              <label className="form-label">Phone Number ID (Meta)</label>
              <input
                type="text"
                className="form-input"
                value={waForm.phoneId}
                onChange={e => setWaForm({ ...waForm, phoneId: e.target.value })}
                placeholder="Ej: 105827364810293"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">System Access Token (Meta API)</label>
              <input
                type="password"
                className="form-input"
                value={waForm.token}
                onChange={e => setWaForm({ ...waForm, token: e.target.value })}
                placeholder="Token de acceso permanente de Meta Developer..."
                required
              />
            </div>

            <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>Plantillas de Notificación</h4>
            <p className="text-secondary" style={{ fontSize: 12, marginBottom: 'var(--space-md)' }}>
              Estas plantillas deben estar aprobadas en la consola de Meta y usan variables: <strong>{"{{1}}"}</strong>: Nombre cliente, <strong>{"{{2}}"}</strong>: Salón, <strong>{"{{3}}"}</strong>: Fecha, <strong>{"{{4}}"}</strong>: Hora.
            </p>

            <div className="form-group">
              <label className="form-label">Confirmación de Turno</label>
              <textarea
                className="form-input"
                rows="3"
                value={waForm.templateConfirmation}
                onChange={e => setWaForm({ ...waForm, templateConfirmation: e.target.value })}
                placeholder="Plantilla de confirmación..."
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Recordatorio de Turno (T-24h / T-2h)</label>
              <textarea
                className="form-input"
                rows="3"
                value={waForm.templateReminder}
                onChange={e => setWaForm({ ...waForm, templateReminder: e.target.value })}
                placeholder="Plantilla de recordatorio..."
                style={{ resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 'var(--space-md)' }}>
              <button type="submit" className="btn btn-primary">
                Guardar Configuración WhatsApp
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: WHATSAPP LOGS */}
      {totalBusinesses > 0 && activeTab === 'logs' && (
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <div>
              <h3 style={{ margin: 0 }}>Historial de Envíos de WhatsApp</h3>
              <p className="text-secondary" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                Monitoreo en tiempo real de notificaciones enviadas a clientes.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select
                className="form-input"
                value={logBusinessFilter}
                onChange={e => setLogBusinessFilter(e.target.value)}
                style={{ margin: 0, width: 180 }}
              >
                <option value="all">Todas las Barberías</option>
                {businesses?.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select
                className="form-input"
                value={logStatusFilter}
                onChange={e => setLogStatusFilter(e.target.value)}
                style={{ margin: 0, width: 130 }}
              >
                <option value="all">Todos los Estados</option>
                <option value="sent">Enviados</option>
                <option value="failed">Fallidos</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="date"
                  className="form-input"
                  value={logDateFilter}
                  onChange={e => setLogDateFilter(e.target.value)}
                  style={{ margin: 0, width: 140 }}
                />
                {logDateFilter && (
                  <button 
                    onClick={() => setLogDateFilter('')}
                    className="btn btn-outline"
                    style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-secondary)', borderColor: 'var(--border-color)', margin: 0 }}
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>
          </div>
          
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha/Hora</th>
                <th>Origen</th>
                <th>Destinatario</th>
                <th>Tipo</th>
                <th>Mensaje</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs?.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span style={{ fontSize: 12 }}>
                      {log.sentAt ? log.sentAt.replace('T', ' ').substring(0, 16) : '—'}
                    </span>
                  </td>
                  <td>
                    <strong>{log.businessName}</strong>
                  </td>
                  <td>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{log.recipientName}</span>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.recipient}</div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: 11 }}>{log.type}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: 12, maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.message}>
                      {log.message}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${log.status === 'sent' ? 'badge-success' : 'badge-danger'}`} title={log.error}>
                      {log.status === 'sent' ? 'Enviado' : 'Fallido'}
                    </span>
                  </td>
                </tr>
              ))}
              {(!filteredLogs || filteredLogs.length === 0) && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
                    No se encontraron registros de envío con los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* --- MODAL: ALTA DE BARBERÍA (onboarding manual) --- */}
      {showNewBusiness && (
        <NewBusinessModal
          onClose={() => setShowNewBusiness(false)}
          onCreated={(business) => {
            setShowNewBusiness(false);
            handleManageBusiness(business.id);
          }}
        />
      )}

      {/* --- MODAL: REGISTRAR PAGO --- */}
      {modalType === 'payment' && selectedBusiness && (
        <div className="modal-overlay" onClick={() => setModalType(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Registrar Cobro de Abono</h3>
              <button className="modal-close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 13 }}>
                Registra un cobro mensual del abono para <strong>{selectedBusiness.name}</strong>. Se deducirá del saldo actual de deuda.
              </p>
              <div className="form-group">
                <label className="form-label">Deuda Actual</label>
                <div className="form-input" style={{ background: 'var(--bg-secondary)', fontWeight: 'bold' }}>
                  {formatPrice(selectedBusiness.debt)}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Monto Abonado (ARS)</label>
                <input
                  type="number"
                  className="form-input"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="Monto..."
                  required
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModalType(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleRecordPayment}>
                Confirmar Cobro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: EDITAR DEUDA --- */}
      {modalType === 'debt' && selectedBusiness && (
        <div className="modal-overlay" onClick={() => setModalType(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Modificar Saldo de Deuda</h3>
              <button className="modal-close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 13 }}>
                Ajusta manualmente la deuda de <strong>{selectedBusiness.name}</strong>. Esto define el estado final del saldo.
              </p>
              <div className="form-group">
                <label className="form-label">Monto Deuda (ARS)</label>
                <input
                  type="number"
                  className="form-input"
                  value={debtAmount}
                  onChange={e => setDebtAmount(e.target.value)}
                  placeholder="Monto..."
                  required
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModalType(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleEditDebt}>
                Guardar Saldo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: OFRECER UPGRADE DE PLAN --- */}
      {modalType === 'upgrade' && selectedBusiness && (
        <div className="modal-overlay" onClick={() => setModalType(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <h3>Ofrecer Upgrade de Plan</h3>
              <button className="modal-close" onClick={() => setModalType(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 13 }}>
                Actualiza el límite de mensajes de WhatsApp y la tarifa mensual de abono para <strong>{selectedBusiness.name}</strong>.
              </p>
              
              <div className="form-group" style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span className="text-muted">Cuota Actual:</span>
                  <strong>{selectedBusiness.whatsappQuota} mensajes/mes</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span className="text-muted">Abono Actual:</span>
                  <strong>{formatPrice(selectedBusiness.monthlyFee)}/mes</strong>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Seleccionar Plan de Upgrade</label>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PLANS.map(plan => (
                    <label
                      key={plan.id}
                      className="card card-selectable"
                      style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: selectedPlan === plan.id ? '2px solid var(--primary)' : '1px solid var(--border-color)', margin: 0 }}
                    >
                      <input
                        type="radio"
                        name="upgradePlan"
                        checked={selectedPlan === plan.id}
                        onChange={() => setSelectedPlan(plan.id)}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{plan.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {plan.description} · ${plan.monthlyFee.toLocaleString('es-AR')} ARS/mes
                        </div>
                      </div>
                    </label>
                  ))}

                  <label className="card card-selectable" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: selectedPlan === 'personalizado' ? '2px solid var(--primary)' : '1px solid var(--border-color)', margin: 0 }}>
                    <input 
                      type="radio" 
                      name="upgradePlan" 
                      checked={selectedPlan === 'personalizado'} 
                      onChange={() => setSelectedPlan('personalizado')} 
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 13 }}>Plan Personalizado</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Configurar cuota y abono a medida</div>
                    </div>
                  </label>
                </div>
              </div>

              {selectedPlan === 'personalizado' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Límite WhatsApp</label>
                    <input
                      type="number"
                      className="form-input"
                      value={upgradeQuota}
                      onChange={e => setUpgradeQuota(e.target.value)}
                      placeholder="mensajes/mes..."
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Abono Mensual (ARS)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={upgradeFee}
                      onChange={e => setUpgradeFee(e.target.value)}
                      placeholder="precio..."
                      required
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: 'var(--space-md)', padding: 10, borderRadius: 8, background: 'var(--primary-light)', border: '1px solid var(--border-accent)', fontSize: 12, color: '#7a2400' }}>
                <strong>Consumo Excedente:</strong> Cada mensaje enviado por encima del cupo de su plan tendrá un costo de <strong>USD {OVERAGE_COST_USD.toFixed(2)}</strong> (con un margen del 50% sobre el costo real de envío).
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModalType(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleRecordUpgrade}>
                Actualizar Plan
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
