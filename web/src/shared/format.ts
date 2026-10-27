// Display formatting shared by features (en-PH, dates without time-zone shifts).

const dateFormat = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const numberFormat = new Intl.NumberFormat("en-PH");

/** Formats an ISO date (YYYY-MM-DD) as e.g. "May 6, 2026". */
export const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
export const formatCount = (value: number) => numberFormat.format(value);
export const formatHa = (ha: number) => `${numberFormat.format(Math.round(ha))} ha`;
export const formatMm = (mm: number | null) => (mm === null ? "No data" : `${mm.toFixed(1)} mm`);
