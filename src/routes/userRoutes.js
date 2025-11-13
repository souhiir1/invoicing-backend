const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authenticateToken = require('../middleware/authMiddleware');
const bcrypt = require('bcrypt');
const saltRounds = 10;

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);


const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${file.fieldname}${ext}`);
  },
});
const upload = multer({ storage });

router.use(authenticateToken);
router.put('/change-password', async (req, res) => {
  const userId = req.userId;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ 
      error: 'Le mot de passe doit contenir au moins 8 caractères' 
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id, email',
      [hashedPassword, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ 
      success: true,
      message: 'Mot de passe mis à jour avec succès'
    });

  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ 
      error: 'Erreur lors de la mise à jour du mot de passe' 
    });
  }
});
router.put(
  '/profile',
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.userId;
    const fields = req.body;

    if (req.files?.image?.[0]) {
      fields.image = `/uploads/${req.files.image[0].filename}`;
    }
    if (req.files?.logo?.[0]) {
      fields.logo = `/uploads/${req.files.logo[0].filename}`;
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No data to update' });
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = Object.values(fields);

    try {
      const result = await pool.query(
        `UPDATE users SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
        [...values, userId]
      );
      res.json({ success: true, user: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

router.delete('/profile', async (req, res) => {
  const userId = req.userId;

  try {


    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
