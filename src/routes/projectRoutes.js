const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
       p.*,
        STRING_AGG(f.ref_facture, ', ' ORDER BY f.created_at) AS facture_refs
      FROM projects p
      LEFT JOIN invoices f ON p.id = f.project_id
      WHERE p.user_id = $1
      GROUP BY p.id, p.name, p.client_id
    `, [req.userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération projets:', err);
    res.status(500).json({ error: 'Erreur récupération projets' });
  }
});


router.post('/', async (req, res) => {
  const { name, client_id, description, start_date, end_date, amount, remise, final_amount,commentaire} = req.body;

  try {
    const result = await pool.query(`
      INSERT INTO projects (user_id, name, client_id, description, start_date, end_date, amount, remise, final_amount,commentaire)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10)
      RETURNING *
    `, [req.userId, name, client_id, description, start_date, end_date, amount, remise, final_amount,commentaire]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création projet:', err);
    res.status(500).json({ error: 'Erreur création projet' });
  }
});


router.put('/:id', async (req, res) => {
  const { name, client_id, description, start_date, end_date, amount, remise, final_amount ,commentaire} = req.body;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID projet invalide' });
  }

  try {
    const result = await pool.query(`
      UPDATE projects
      SET name = $1,
          client_id = $2,
          description = $3,
          start_date = $4,
          end_date = $5,
          amount = $6,
          remise = $7,
          final_amount = $8,commentaire=$9
      WHERE id = $10 AND user_id = $11
      RETURNING *
    `, [name, client_id, description, start_date, end_date, amount, remise, final_amount,commentaire, id, req.userId]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur modification projet:', err);
    res.status(500).json({ error: 'Erreur modification projet' });
  }
});

router.put('/:id/statut', async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;

  try {
    const updateQuery = 'UPDATE projects SET statut = $1 WHERE id = $2';
    await pool.query(updateQuery, [statut, id]);
    res.status(200).json({ message: 'Statut mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut du projet:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const invoiceCheck = await pool.query(
      'SELECT COUNT(*) FROM invoices WHERE project_id = $1',
      [id]
    );

    if (invoiceCheck.rows[0].count > 0) {
      return res.status(400).json({ error: 'Impossible de supprimer : projet lié à une facture' });
    }

    await pool.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur suppression projet:', err);
    res.status(500).json({ error: 'Erreur suppression projet' });
  }
});
router.get('/byClient/:clientId', authenticateToken, async (req, res) => {
  const { clientId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, name, client_id, user_id FROM projects WHERE client_id = $1`,
      [clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur récupération projets par client:', err);
    res.status(500).json({ error: 'Erreur récupération projets' });
  }
});

module.exports = router;
