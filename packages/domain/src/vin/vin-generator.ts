/**
 * NHTSA-compliant VIN generator for GolfinGarage vehicles.
 *
 * Structure:
 *   Pos 1-3  : WMI   = "1F9"   (GolfinGarage World Manufacturer Identifier)
 *   Pos 4-8  : VDS   = "RUD1A" (Vehicle Descriptor Section, fixed)
 *   Pos 9    : check digit     (computed via NHTSA weighted-sum algorithm)
 *   Pos 10   : model year code (derived from 4-digit model year)
 *   Pos 11   : plant  = "J"    (assembly plant, fixed)
 *   Pos 12-17: sequence        (zero-padded 6-digit auto-increment)
 */

const WMI = '1F9';
const VDS = 'RUD1A';
const PLANT = 'J';

/**
 * NHTSA model year codes (letters I, O, Q, U, Z are excluded).
 * The 30-year cycle repeats; this table covers 2010–2039.
 */
export const MODEL_YEAR_CODES: Record<number, string> = {
  2010: 'A', 2011: 'B', 2012: 'C', 2013: 'D', 2014: 'E',
  2015: 'F', 2016: 'G', 2017: 'H', 2018: 'J', 2019: 'K',
  2020: 'L', 2021: 'M', 2022: 'N', 2023: 'P', 2024: 'R',
  2025: 'S', 2026: 'T', 2027: 'V', 2028: 'W', 2029: 'X',
  2030: 'Y', 2031: '1', 2032: '2', 2033: '3', 2034: '4',
  2035: '5', 2036: '6', 2037: '7', 2038: '8', 2039: '9',
};

/** Maps a 4-digit model year to its NHTSA position-10 code. */
export function modelYearToCode(year: number): string {
  const code = MODEL_YEAR_CODES[year];
  if (!code) {
    throw new Error(
      `Unsupported model year ${year}. Supported range: ${Math.min(...Object.keys(MODEL_YEAR_CODES).map(Number))}–${Math.max(...Object.keys(MODEL_YEAR_CODES).map(Number))}.`,
    );
  }
  return code;
}

// NHTSA transliteration table: letters → numeric values (I, O, Q, U, Z excluded)
const TRANSLITERATION: Record<string, number> = {
  A: 1,  B: 2,  C: 3,  D: 4,  E: 5,  F: 6,  G: 7,  H: 8,
  J: 1,  K: 2,  L: 3,  M: 4,  N: 5,  P: 7,  R: 9,
  S: 2,  T: 3,  U: 4,  V: 5,  W: 6,  X: 7,  Y: 8,  Z: 9,
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
  '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
};

// Position weights for the 17 VIN positions (position 9 = check digit has weight 0)
const POSITION_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Computes the NHTSA check digit for a 17-character VIN string.
 * Position 9 (index 8) is ignored in the input (may be any character).
 * Returns '0'–'9' or 'X'.
 */
export function computeCheckDigit(vin17: string): string {
  if (vin17.length !== 17) {
    throw new Error(`VIN must be exactly 17 characters; got ${vin17.length}.`);
  }

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue; // skip check digit position

    const char = vin17[i].toUpperCase();
    const value = TRANSLITERATION[char];
    if (value === undefined) {
      throw new Error(`Invalid VIN character '${char}' at position ${i + 1}.`);
    }
    sum += value * POSITION_WEIGHTS[i];
  }

  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/**
 * Generates a full 17-character NHTSA-valid VIN for a GolfinGarage vehicle.
 *
 * @param modelYear     - 4-digit model year (e.g. 2025)
 * @param sequenceNumber - Auto-incremented integer from the database (e.g. 47)
 */
export function generateVin(modelYear: number, sequenceNumber: number): string {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > 999999) {
    throw new Error(`Sequence number must be an integer between 1 and 999999; got ${sequenceNumber}.`);
  }

  const yearCode = modelYearToCode(modelYear);
  const seq = String(sequenceNumber).padStart(6, '0');

  // Assemble with placeholder at position 9 (index 8)
  const partial = `${WMI}${VDS}0${yearCode}${PLANT}${seq}`;
  const checkDigit = computeCheckDigit(partial);

  return `${WMI}${VDS}${checkDigit}${yearCode}${PLANT}${seq}`;
}
