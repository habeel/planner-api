export function getWeekRange(weekStart: string): { start: Date; end: Date } {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

export function getMonthRange(month: string): { start: Date; end: Date } {
  const [year, monthNum] = month.split('-').map(Number);
  const start = new Date(year!, monthNum! - 1, 1);
  const end = new Date(year!, monthNum!, 0);
  return { start, end };
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
