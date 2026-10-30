// Signals the guided tour listens for. Pages call tourSignal() at key moments
// so the tour can advance on its own as the visitor clicks through.
export type TourSignal = 'wizard_opened' | 'wizard_closed' | 'schedule_updated' | 'notified';

export function tourSignal(signal: TourSignal): void {
  window.dispatchEvent(new CustomEvent<TourSignal>('hc:tour', { detail: signal }));
}

export function startTour(): void {
  window.dispatchEvent(new Event('hc:tour-start'));
}
