const PDFDocument = require('pdfkit');

class InvoiceGenerator {
  /**
   * Generate invoice PDF as a buffer
   */
  async generateInvoice(transactionData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        // Collect PDF data into buffer
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Add content to PDF
        this.addHeader(doc);
        this.addInvoiceDetails(doc, transactionData);
        this.addItemDetails(doc, transactionData);
        this.addFooter(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  addHeader(doc) {
    doc
      .fontSize(20)
      .text('YAVULI MARKETPLACE', 50, 50, { align: 'center' })
      .fontSize(10)
      .text('Invoice', 50, 80, { align: 'center' })
      .moveDown();
  }

  addInvoiceDetails(doc, data) {
    const { transaction, buyer, seller } = data;
    
    doc
      .fontSize(12)
      .text(`Invoice #: ${transaction.id}`, 50, 120)
      .text(`Date: ${new Date(transaction.transaction_date).toLocaleDateString('en-IN')}`, 50, 140)
      .text(`Payment Method: Razorpay`, 50, 160)
      .moveDown()
      .text('Buyer Information:', 50, 200)
      .fontSize(10)
      .text(`Name: ${buyer.full_name || buyer.email}`, 50, 220)
      .text(`Email: ${buyer.email}`, 50, 235)
      .moveDown()
      .fontSize(12)
      .text('Seller Information:', 50, 270)
      .fontSize(10)
      .text(`Name: ${seller.full_name || seller.email}`, 50, 290)
      .text(`Email: ${seller.email}`, 50, 305);
  }

  addItemDetails(doc, data) {
    const { transaction, listing } = data;
    
    doc
      .moveDown()
      .fontSize(12)
      .text('Item Details:', 50, 350)
      .moveTo(50, 370)
      .lineTo(550, 370)
      .stroke();

    doc
      .fontSize(10)
      .text('Description', 50, 380)
      .text('Amount', 450, 380, { width: 100, align: 'right' });

    doc
      .moveTo(50, 395)
      .lineTo(550, 395)
      .stroke();

    doc
      .text(listing.title, 50, 410, { width: 350 })
      .text(`₹${transaction.amount}`, 450, 410, { width: 100, align: 'right' });

    doc
      .moveTo(50, 450)
      .lineTo(550, 450)
      .stroke();

    doc
      .fontSize(12)
      .text('Total Amount:', 350, 470)
      .text(`₹${transaction.amount}`, 450, 470, { width: 100, align: 'right' });
  }

  addFooter(doc) {
    doc
      .fontSize(8)
      .text('Thank you for using Yavuli Marketplace!', 50, 700, { align: 'center' })
      .text('For support: support@yavulimarketplace.com', 50, 715, { align: 'center' });
  }
}

module.exports = new InvoiceGenerator();
