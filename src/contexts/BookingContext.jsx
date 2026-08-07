import { createContext, useContext, useReducer } from 'react';

const BookingContext = createContext();

const initialBooking = {
  step: 1,
  professionalId: null,
  serviceId: null,
  date: null,
  timeSlot: null,
  personalInfo: { name: '', phone: '', email: '', notes: '' },
};

function bookingReducer(state, action) {
  switch (action.type) {
    case 'SET_PROFESSIONAL':
      return { ...state, professionalId: action.payload, serviceId: null, date: null, timeSlot: null };
    case 'SET_SERVICE':
      return { ...state, serviceId: action.payload, date: null, timeSlot: null };
    case 'SET_DATE':
      return { ...state, date: action.payload, timeSlot: null };
    case 'SET_TIMESLOT':
      return { ...state, timeSlot: action.payload };
    case 'SET_PERSONAL_INFO':
      return { ...state, personalInfo: { ...state.personalInfo, ...action.payload } };
    case 'SET_STEP':
      return { ...state, step: action.payload };
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, 7) };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 1) };
    case 'RESET':
      return { ...initialBooking };
    default:
      return state;
  }
}

export function BookingProvider({ children }) {
  const [booking, dispatch] = useReducer(bookingReducer, initialBooking);

  return (
    <BookingContext.Provider value={{ booking, dispatch }}>
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error('useBooking must be used within BookingProvider');
  return context;
}
