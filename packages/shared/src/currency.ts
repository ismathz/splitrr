/** ISO 4217 codes for bill currency pickers (subset). */
export const BILL_CURRENCY_OPTIONS: ReadonlyArray<{ code: string; label: string }> =
  [
    { code: "USD", label: "USD — US dollar" },
    { code: "EUR", label: "EUR — Euro" },
    { code: "GBP", label: "GBP — British pound" },
    { code: "MVR", label: "MVR — Maldivian rufiyaa" },
    { code: "INR", label: "INR — Indian rupee" },
    { code: "JPY", label: "JPY — Japanese yen" },
    { code: "AUD", label: "AUD — Australian dollar" },
    { code: "CAD", label: "CAD — Canadian dollar" },
    { code: "CHF", label: "CHF — Swiss franc" },
    { code: "SGD", label: "SGD — Singapore dollar" },
    { code: "AED", label: "AED — UAE dirham" },
    { code: "SAR", label: "SAR — Saudi riyal" },
    { code: "THB", label: "THB — Thai baht" },
    { code: "MYR", label: "MYR — Malaysian ringgit" },
    { code: "IDR", label: "IDR — Indonesian rupiah" },
    { code: "KRW", label: "KRW — South Korean won" },
    { code: "CNY", label: "CNY — Chinese yuan" },
    { code: "HKD", label: "HKD — Hong Kong dollar" },
    { code: "NZD", label: "NZD — New Zealand dollar" },
    { code: "SEK", label: "SEK — Swedish krona" },
    { code: "NOK", label: "NOK — Norwegian krone" },
    { code: "DKK", label: "DKK — Danish krone" },
    { code: "PLN", label: "PLN — Polish złoty" },
    { code: "CZK", label: "CZK — Czech koruna" },
    { code: "HUF", label: "HUF — Hungarian forint" },
    { code: "BRL", label: "BRL — Brazilian real" },
    { code: "MXN", label: "MXN — Mexican peso" },
    { code: "ZAR", label: "ZAR — South African rand" },
  ];

/** Normalize OCR or user input to a 3-letter ISO 4217 code; fallback USD. */
export function normalizeCurrencyCode(input: string): string {
  const t = input.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(t)) return t;
  return "USD";
}
