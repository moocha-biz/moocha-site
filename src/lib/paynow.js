// Builds an EMVCo "Merchant Presented QR" payload for Singapore's PayNow
// (MAS SGQR spec) with the amount pre-filled and locked, so the customer's
// banking app opens straight to "confirm payment" instead of a blank
// transfer form. Change PAYNOW_MOBILE below if the payout number changes.
const PAYNOW_MOBILE = '+6591876173';

function tlv(id, value) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the checksum algorithm
// the EMVCo QR spec requires for field 63, computed over every preceding
// byte of the payload including the "6304" tag+length of this field itself.
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// reference (e.g. a walk-in order id) shows up as the "Bill Reference" in
// the payer's banking app once they scan — keep it short, it's a display
// field, not something PayNow validates.
export function buildPayNowPayload({ amount, reference, mobile = PAYNOW_MOBILE, merchantName = 'Moocha' }) {
  const merchantAccount = tlv('00', 'SG.PAYNOW') + tlv('01', '0') + tlv('02', mobile) + tlv('03', '0');
  const additionalData = reference ? tlv('62', tlv('01', String(reference).slice(0, 25))) : '';
  let payload =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('26', merchantAccount) +
    tlv('52', '0000') +
    tlv('53', '702') +
    tlv('54', Number(amount).toFixed(2)) +
    tlv('58', 'SG') +
    tlv('59', merchantName.slice(0, 25)) +
    tlv('60', 'Singapore') +
    additionalData +
    '6304';
  return payload + crc16ccitt(payload);
}
