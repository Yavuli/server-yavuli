function calculatePaymentBreakdown(itemPriceInRupees) {
  if (!itemPriceInRupees || itemPriceInRupees <= 0) {
    throw new Error('Item price must be a positive number');
  }
  if (itemPriceInRupees > 1000000) { 
    throw new Error('Item price exceeds maximum allowed limit');
  }

  // Calculate fees
  const platformFeeInRupees = Math.round(itemPriceInRupees * 0.05);
  const sellerAmountInRupees = itemPriceInRupees - platformFeeInRupees;

  return {
    itemPrice: itemPriceInRupees,
    platformFee: platformFeeInRupees,
    sellerAmount: sellerAmountInRupees,
    totalAmount: itemPriceInRupees, // Buyer pays the item price
    feePercentage: 5,
  };
}

function formatForDatabase(itemPriceInRupees) {
  const breakdown = calculatePaymentBreakdown(itemPriceInRupees);

  return {
    itemPrice: breakdown.itemPrice,
    platformFee: breakdown.platformFee,
    sellerAmount: breakdown.sellerAmount,
    totalAmount: breakdown.totalAmount,
  };
}

function getTotalAmountInRupees(itemPriceInRupees) {
  return calculatePaymentBreakdown(itemPriceInRupees).totalAmount;
}

module.exports = {
  calculatePaymentBreakdown,
  formatForDatabase,
  getTotalAmountInRupees,
};