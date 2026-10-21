// Money guard (D14): the fields that hold an amount, and a backstop for text
// that might carry one. A member without money never sees such a line.

export const moneyFields: readonly string[] = ["brand_price", "influencer_payout", "budget"];

const signBeforeDigit = /[$€£]\s?\d/;
const codeBesideNumber = /\d\s?(?:USD|EUR|GBP|dollars?)\b|\b(?:USD|EUR|GBP)\s?\d/i;

export function mentionsMoney(text: string): boolean {
  return signBeforeDigit.test(text) || codeBesideNumber.test(text);
}
