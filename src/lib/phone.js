// SG mobile numbers are 8 digits starting with 8 or 9 — the same shape the
// IDOR-fix migrations assume when they call this an "8-digit SG mobile
// number". Strips spaces/dashes and an optional +65/65 prefix first, so
// "9123 4567", "+65 9123 4567", and "91234567" all normalize to the same
// value instead of silently becoming different customer records (and thus
// different stamp cards/order histories) for the same person.
export function normalizeSgPhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const stripped = digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
  return /^[89]\d{7}$/.test(stripped) ? stripped : null;
}
