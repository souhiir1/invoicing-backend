const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const PDFDocument = require('pdfkit');

router.use(authenticateToken);

// GET /api/pdf/:invoiceId → return PDF
router.get('/:invoiceId', async (req, res) => {
  const { invoiceId } = req.params;
  const userId = req.userId;

  try {
    const result = await pool.query(
      `SELECT invoices.*, clients.name AS client_name, clients.company
       FROM invoices
       LEFT JOIN clients ON invoices.client_id = clients.id
       WHERE invoices.id = $1 AND invoices.user_id = $2`,
      [invoiceId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    const doc = new PDFDocument();

    // Stream it to response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoice_number}.pdf`);
    doc.pipe(res);

    // 🧾 Start PDF content
    doc.fontSize(20).text('Facture', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Facture N°: ${invoice.invoice_number}`);
    doc.text(`Date émission: ${invoice.issue_date}`);
    doc.text(`Client: ${invoice.client_name || ''} (${invoice.company || ''})`);
    doc.moveDown();

    doc.text('Articles:', { underline: true });
    const items = invoice.items;
    const parsedItems = Array.isArray(items)
      ? items
      : typeof items === 'string'
      ? JSON.parse(items)
      : [];

    parsedItems.forEach((item, idx) => {
      doc.text(`${idx + 1}. ${item.description} - Qté: ${item.quantity}, Prix: ${item.price} TND`);
    });

    doc.moveDown();
    doc.text(`Remise: ${invoice.remise} TND`);
    doc.text(`Total HT: ${invoice.total_ht} TND`);
    doc.text(`Total TTC: ${invoice.total_ttc} TND`);
    doc.text(`Statut: ${invoice.status}`);
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
