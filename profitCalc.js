/**
 * Calculates investment profit after capital gains tax.
 * @param {number} purchasePrice - The price paid per unit.
 * @param {number} currentPrice - The current price per unit.
 * @param {number} quantity - Number of units held.
 * @returns {{ grossProfit: number, netProfit: number, taxAmount: number }}
 */
function calcInvestmentProfit(purchasePrice, currentPrice, quantity) {
  const grossProfit = (currentPrice - purchasePrice) * quantity;
  const taxAmount = grossProfit * 0.25;
  const netProfit = grossProfit - taxAmount;
  return { grossProfit, netProfit, taxAmount };
}

module.exports = calcInvestmentProfit;
