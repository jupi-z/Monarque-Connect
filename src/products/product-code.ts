/** Stable, server-controlled product identifiers used by product-scoped Core contracts. */
export const PRODUCT_CODES = Object.freeze(['MONARQUE_CONNECT', 'ZAMUREK'] as const);

export type ProductCode = (typeof PRODUCT_CODES)[number];

/** Validates an identifier without converting or normalizing untrusted input. */
export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === 'string' && (PRODUCT_CODES as readonly string[]).includes(value);
}
