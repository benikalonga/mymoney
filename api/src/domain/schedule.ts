export type Frequency = 'weekly' | 'monthly';

/**
 * Next run after `from`. Monthly schedules keep their anchor day, so a payment
 * on the 31st falls on the last day of shorter months and returns to the 31st.
 */
export function nextRunDate(from: Date, frequency: Frequency, anchorDay: number): Date {
  const next = new Date(from);
  if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next;
}
