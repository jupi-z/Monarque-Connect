export type RationalMeasure = {
  code: string;
  dimension: string;
  baseUnitCode: string;
  numerator: bigint;
  denominator: bigint;
};

const SCALE = 12;
const SCALE_FACTOR = 10n ** BigInt(SCALE);
const MAX_NORMALIZED_SCALED = 10n ** 24n;
const DECIMAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/;

/** Exact conversion through the shared base unit; values not representable at scale 12 are rejected. */
export function convertMeasureQuantity(value: string, from: RationalMeasure, to: RationalMeasure): string {
  if (!DECIMAL.test(value) || !/[1-9]/.test(value)) throw new Error('Quantity must be positive and have at most 12 fractional digits');
  if (from.dimension !== to.dimension || from.baseUnitCode !== to.baseUnitCode) throw new Error('Measure dimensions are incompatible');
  if (from.numerator <= 0n || from.denominator <= 0n || to.numerator <= 0n || to.denominator <= 0n) throw new Error('Measure factor is invalid');

  const [whole, fraction = ''] = value.split('.');
  const quantityScaled = BigInt(whole!) * SCALE_FACTOR + BigInt(fraction.padEnd(SCALE, '0'));
  const numerator = quantityScaled * from.numerator * to.denominator;
  const denominator = from.denominator * to.numerator;
  if (numerator % denominator !== 0n) throw new Error(`Conversion cannot be represented exactly at ${SCALE} decimal places`);

  const resultScaled = numerator / denominator;
  if (resultScaled >= MAX_NORMALIZED_SCALED) throw new Error('Normalized quantity exceeds NUMERIC(24,12) range');
  const integer = resultScaled / SCALE_FACTOR;
  const decimal = (resultScaled % SCALE_FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return decimal ? `${integer}.${decimal}` : integer.toString();
}
