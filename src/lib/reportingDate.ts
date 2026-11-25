export function getReportingDateKey(
  value: Date | string,
  timezone = 'Asia/Dhaka',
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function getReportingMonthKey(
  value: Date | string,
  timezone = 'Asia/Dhaka',
): string {
  const key = getReportingDateKey(value, timezone);
  return key.slice(0, 7);
}
