import { useState } from 'react';

const WHATSAPP_NUMBER = '5492257529684';
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  'Hola, quiero consultar sobre BarberOS para mi barbería.'
)}`;

const FAQ_RESPONSES = {
  precios: `Nuestros planes mensuales en pesos argentinos son:
• Plan Básico: $12.000/mes (Hasta 2 barberos, 100 WhatsApp/mes)
• Plan Pro: $22.000/mes (Hasta 5 barberos, 500 WhatsApp/mes, estadísticas)
• Plan Business: $35.000/mes (Barberos ilimitados, 2000 WhatsApp/mes, soporte dedicado)

Todos los planes incluyen tu propia agenda online con tu marca y sin permanencia.`,

  alta: `¡El alta es súper rápida! No tenés que configurar nada vos solo. 
Nosotros cargamos tu equipo, tus servicios, horarios y precios el mismo día. Vos solo compartís el link en Instagram o WhatsApp y listo.`,

  diferencias: `La diferencia principal entre planes radica en la cantidad de barberos de tu equipo y el volumen de avisos por WhatsApp:
• Básico: Ideal para 1 o 2 barberos.
• Pro: Para barberías de 3 a 5 barberos + estadísticas de caja y servicios sin turno en vivo.
• Business: Sin límite de barberos + exportación de clientes y reportes avanzados.`,
};

export default function FloatingActionWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: '¡Hola! 👋 Soy el asistente virtual de BarberOS. ¿En qué puedo ayudarte hoy?',
    },
  ]);
  const [inputText, setInputText] = useState('');

  const handleSendMessage = (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    // Add user message
    const newMessages = [...messages, { sender: 'user', text }];
    setMessages(newMessages);
    if (!textToSend) setInputText('');

    // Simulate AI bot response
    setTimeout(() => {
      const lower = text.toLowerCase();
      let botReply = '';

      if (lower.includes('precio') || lower.includes('cuanto') || lower.includes('costo') || lower.includes('plan')) {
        botReply = FAQ_RESPONSES.precios;
      } else if (lower.includes('alta') || lower.includes('como funciona') || lower.includes('configur')) {
        botReply = FAQ_RESPONSES.alta;
      } else if (lower.includes('diferencia') || lower.includes('compar') || lower.includes('pro') || lower.includes('business')) {
        botReply = FAQ_RESPONSES.diferencias;
      } else if (lower.includes('whatsapp') || lower.includes('hablar') || lower.includes('humano')) {
        botReply = '¡Por supuesto! Podés contactarnos directamente por WhatsApp al +54 9 2257 529684 para atención personalizada.';
      } else {
        botReply = `Entendido. Para darte la mejor atención personalizada para tu barbería, te recomiendo hablar directamente con nuestro equipo por WhatsApp.`;
      }

      setMessages((prev) => [...prev, { sender: 'bot', text: botReply }]);
    }, 600);
  };

  return (
    <div className="fab-container">
      {/* ── EXPANDABLE SUB-BUTTONS ── */}
      {isOpen && (
        <div className="fab-sub-buttons animate-fade-in">
          {/* Sub-button 1: WhatsApp */}
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noreferrer"
            className="fab-sub-btn fab-whatsapp"
            title="Hablamos por WhatsApp"
          >
            <span className="fab-tooltip">Hablamos por WhatsApp</span>
            <span className="fab-icon">💬</span>
          </a>

          {/* Sub-button 2: Asistente IA */}
          <button
            type="button"
            className="fab-sub-btn fab-ai"
            onClick={() => {
              setIsChatOpen(true);
              setIsOpen(false);
            }}
            title="Asistente BarberOS IA"
          >
            <span className="fab-tooltip">Asistente IA</span>
            <span className="fab-icon">🤖</span>
          </button>
        </div>
      )}

      {/* ── MAIN FAB BUTTON ── */}
      <button
        type="button"
        className={`fab-main-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menú de ayuda y contacto"
      >
        <span className="fab-pulse-ring" />
        <span className="fab-main-icon">{isOpen ? '✕' : '💬'}</span>
      </button>

      {/* ── AI CHAT MODAL WINDOW ── */}
      {isChatOpen && (
        <div className="chat-modal-overlay">
          <div className="chat-modal-card animate-slide-up">
            {/* Header */}
            <div className="chat-modal-header">
              <div className="chat-bot-info">
                <div className="chat-bot-avatar">🤖</div>
                <div>
                  <strong>Asistente BarberOS IA</strong>
                  <span className="chat-status">• Online · Respuesta en vivo</span>
                </div>
              </div>
              <button
                type="button"
                className="chat-close-btn"
                onClick={() => setIsChatOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Messages Body */}
            <div className="chat-modal-messages">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`chat-bubble ${m.sender === 'user' ? 'bubble-user' : 'bubble-bot'}`}
                >
                  <p>{m.text}</p>
                </div>
              ))}
            </div>

            {/* Quick Chips */}
            <div className="chat-quick-chips">
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleSendMessage('¿Cuáles son los precios?')}
              >
                💰 Precios
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleSendMessage('¿Cómo es el alta?')}
              >
                🚀 Cómo arranca
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => handleSendMessage('¿Qué diferencia hay entre planes?')}
              >
                📊 Diferencia de planes
              </button>
            </div>

            {/* Footer Input Form */}
            <form
              className="chat-modal-footer"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
            >
              <input
                type="text"
                className="chat-input"
                placeholder="Escribí tu duda acá..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <button type="submit" className="chat-send-btn">
                Enviar
              </button>
            </form>

            <div className="chat-wa-direct">
              <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
                💬 O preferís hablar directo por WhatsApp →
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
