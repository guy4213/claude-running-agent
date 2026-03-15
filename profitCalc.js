/**
 * Calculates investment profit after capital gains tax.
 * @param {number} purchasePrice - The price at which the asset was purchased (per unit).
 * @param {number} currentPrice - The current price of the asset (per unit).
 * @param {number} quantity - The number of units held.
 * @returns {{ grossProfit: number, taxAmount: number, netProfit: number }}
 */
function calcInvestmentProfit(purchasePrice, currentPrice, quantity) {
  const grossProfit = (currentPrice - purchasePrice) * quantity;
  const taxAmount = grossProfit * 0.25;
  const netProfit = grossProfit - taxAmount;
  return { grossProfit, taxAmount, netProfit };
}

module.exports = calcInvestmentProfit;
