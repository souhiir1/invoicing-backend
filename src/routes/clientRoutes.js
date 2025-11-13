const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');

const updateClientSolde = require('../utils/updateClientSolde');

router.use(authenticateToken);

router.get('/with-meta', async (req, res) => {
  try {
    // console.log("test")
    const result = await pool.query(`
      SELECT 
        c.*, 
        (SELECT COUNT(*) FROM invoices WHERE client_id = c.id) AS facture_count,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id) AS project_count,
        (SELECT id FROM invoices WHERE client_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_facture_id,
        (SELECT id FROM projects WHERE client_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_project_id
      FROM clients c
      WHERE c.user_id = $1
      ORDER BY c.id DESC
    `, [req.userId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération clients' });
  }
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});


router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM clients WHERE user_id = $1 ORDER BY id DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});


router.post('/', async (req, res) => {
  const { name, company, email, phone, address, matricule_fiscale,  solde_ini } = req.body;
  try {
   const result = await pool.query(
  `INSERT INTO clients (user_id, name, company, email, phone, address, matricule_fiscale,  solde_ini)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   RETURNING *`,
  [
    req.userId,
    name,
    company,
    email,
    phone,
    address,
    matricule_fiscale,
   
    solde_ini || 0,
  ]
);
   const newClient = result.rows[0];

    await updateClientSolde(newClient.id, req.userId);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});


router.put('/:id', async (req, res) => {
  const { name, company, email, phone, address, matricule_fiscale, solde_ini } = req.body;
  const id = parseInt(req.params.id, 10); 


  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }

  try {
    const result = await pool.query(
      `UPDATE clients
       SET name = $1, company = $2, email = $3, phone = $4, address = $5,
           matricule_fiscale = $6,  solde_ini = $7
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        name,
        company,
        email,
        phone,
        address,
        matricule_fiscale,
      
        parseFloat(solde_ini) || 0,
        id,
        req.userId,
      ]
    );
await updateClientSolde(id, req.userId);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});


router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const invoiceCheck = await pool.query('SELECT COUNT(*) FROM invoices WHERE client_id = $1', [id]);
    const projectCheck = await pool.query('SELECT COUNT(*) FROM projects WHERE client_id = $1', [id]);

    if (invoiceCheck.rows[0].count > 0 || projectCheck.rows[0].count > 0) {
      return res.status(400).json({ error: 'Impossible de supprimer : client lié à des projets ou factures' });
    }

    await pool.query('DELETE FROM clients WHERE id = $1 AND user_id = $2', [id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur suppression client' });
  }
});

// Add this route to your clients routes
router.get('/:id/details', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }

  try {
    
    const clientResult = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];

    const invoicesResult = await pool.query(
      'SELECT ref_facture FROM invoices WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10',
      [id]
    );

 
    const projectsResult = await pool.query(
      'SELECT name FROM projects WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10',
      [id]
    );

    client.factures = invoicesResult.rows;
    client.projects = projectsResult.rows;

    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch client details' });
  }
});

module.exports = router;
