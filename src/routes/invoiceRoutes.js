const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const updateClientSolde = require('../utils/updateClientSolde');

router.use(authenticateToken);
 
router.get('/nextRef', async (req, res) => {
  try {
   
    const year = new Date().getFullYear().toString().slice(-2); 

    const result = await pool.query(
      `SELECT ref_facture FROM invoices WHERE ref_facture LIKE $1 ORDER BY id DESC LIMIT 1`,
      [`FAC${year}%`]
    );

    let nextNumber = 1; 

    if (result.rows.length > 0 && result.rows[0].ref_facture) {
      const lastRef = result.rows[0].ref_facture; 
      const lastNum = parseInt(lastRef.slice(4), 10); 
      if (!isNaN(lastNum)) nextNumber = lastNum + 1;
    }


    const refFacture = `FAC${year}${String(nextNumber).padStart(4, '0')}`; 
    
    res.json({ ref_facture: refFacture });
  } catch (err) {
    console.error('Erreur génération ref_facture:', err);
    res.status(500).json({ error: 'Erreur génération ref_facture' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        inv.*,
        c.name AS client_name,
        c.matricule_fiscale,
        p.name AS project_name,
        COALESCE(items.items, '[]'::json) AS items
      FROM invoices inv
      LEFT JOIN clients c ON inv.client_id = c.id AND c.user_id = $1
      LEFT JOIN projects p ON inv.project_id = p.id AND p.user_id = $1
      LEFT JOIN (
        SELECT invoice_id, json_agg(
          json_build_object(
            'id', id,
            'article', article,
            'qte', qte,
            'prix_ht', prix_ht,
            'tva', tva,
            'remise', remise,
            'prix_ttc', prix_ttc,
            'ref_facture', ref_facture
          ) ORDER BY id
        ) AS items
        FROM invoice_items
        GROUP BY invoice_id
      ) items ON items.invoice_id = inv.id
      WHERE inv.user_id = $1
      ORDER BY inv.created_at DESC
      `,
      [req.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération factures:', err);
    res.status(500).json({ error: 'Erreur récupération factures' });
  }
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID facture invalide' });

  try {
    const invoiceRes = await pool.query(
      `SELECT * FROM invoices WHERE id = $1 AND user_id = $2`,
      [id, req.userId]
    );

    if (invoiceRes.rows.length === 0)
      return res.status(404).json({ error: 'Facture non trouvée' });

    const itemsRes = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [id]
    );

    res.json({ ...invoiceRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    console.error('Erreur récupération facture:', err);
    res.status(500).json({ error: 'Erreur récupération facture' });
  }
});

router.post('/', async (req, res) => {
  const {
    client_id,
    invoice_number,
    issue_date,
    due_date,
    total_ht,
    remise,
    total_ttc,
    status,
    project_id,
    ref_facture,
    payment_method,
    payment_status,
    tva,
    timber,
    items = []
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoiceRes = await client.query(
      `
      INSERT INTO invoices
      (user_id, client_id, invoice_number, issue_date, due_date, total_ht, remise, total_ttc,
       status, project_id, ref_facture, payment_method, payment_status, tva, timber, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
      RETURNING *
      `,
      [
        req.userId,
        client_id || null,
        invoice_number || null,
        issue_date || null,
        due_date || null,
        total_ht || 0,
        remise || 0,
        total_ttc || 0,
        status || 'En attente',
        project_id || null,
        ref_facture || null,
        payment_method || null,
        payment_status || 'En attente',
        tva || 0,
        timber || 0
      ]
    );

    const invoice = invoiceRes.rows[0];

    // Insert items
    for (const it of items) {
      await client.query(
        `
        INSERT INTO invoice_items
        (invoice_id, ref_facture, article, qte, prix_ht, tva, remise, prix_ttc, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        `,
        [
          invoice.id,
          ref_facture || invoice.ref_facture || null,
          it.article || '',
          it.qte || 0,
          it.prix_ht || 0,
          it.tva || 0,
          it.remise || 0,
          it.prix_ttc || 0
        ]
      );
    }

    await client.query('COMMIT');
await updateClientSolde(client_id, req.userId);

    const itemsRes = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoice.id]
    );

    res.status(201).json({ ...invoice, items: itemsRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création facture:', err);
    res.status(500).json({ error: 'Erreur création facture' });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID facture invalide' });

  const {
    client_id,
    invoice_number,
    issue_date,
    due_date,
    total_ht,
    remise,
    total_ttc,
    status,
    project_id,
    ref_facture,
    payment_method,
    payment_status,
    tva,
    timber,
    items = []
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

   const cleanDate = (date) => (date && date !== '' ? date : null);

const invoiceRes = await client.query(
  `
  UPDATE invoices SET
    client_id=$1, invoice_number=$2, issue_date=$3, due_date=$4,
    total_ht=$5, remise=$6, total_ttc=$7, status=$8,
    project_id=$9, ref_facture=$10, payment_method=$11,
    payment_status=$12, tva=$13, timber=$14, updated_at=NOW()
  WHERE id=$15 AND user_id=$16
  RETURNING *
  `,
  [
    client_id,
    invoice_number,
    cleanDate(issue_date),
    cleanDate(due_date),
    total_ht || 0,
    remise || 0,
    total_ttc || 0,
    status || 'En attente',
    project_id || null,
    ref_facture || null,
    payment_method || null,
    payment_status || 'En attente',
    tva || 0,
    timber || 0,
    id,
    req.userId
  ]
);
    if (invoiceRes.rows.length === 0)
      return res.status(404).json({ error: 'Facture non trouvée' });

    await client.query(`DELETE FROM invoice_items WHERE invoice_id=$1`, [id]);

    for (const it of items) {
      await client.query(
        `
        INSERT INTO invoice_items
        (invoice_id, ref_facture, article, qte, prix_ht, tva, remise, prix_ttc, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        `,
        [
          id,
          ref_facture || invoiceRes.rows[0].ref_facture || null,
          it.article || '',
          it.qte || 0,
          it.prix_ht || 0,
          it.tva || 0,
          it.remise || 0,
          it.prix_ttc || 0
        ]
      );
    }

    await client.query('COMMIT');
await updateClientSolde(client_id, req.userId);

    const itemsRes = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [id]
    );

    res.json({ ...invoiceRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur mise à jour facture:', err);
    res.status(500).json({ error: 'Erreur mise à jour facture' });
  } finally {
    client.release();
  }
});


router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID facture invalide' });

  try {
 
    const invoice = await pool.query(
      'SELECT client_id FROM invoices WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const client_id = invoice.rows[0].client_id;


    const del = await pool.query(
      'DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Facture non trouvée après tentative de suppression' });
    }

  
    await updateClientSolde(client_id, req.userId);

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur suppression facture:', err);
    res.status(500).json({ error: 'Erreur suppression facture' });
  }
});


module.exports = router;
