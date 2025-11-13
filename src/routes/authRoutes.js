const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const sendResetEmail = require('../utils/sendEmail');

const JWT_SECRET = process.env.JWT_SECRET;

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Email non trouvé" });
    }

    const token = uuidv4();
  const expires = new Date(); 
expires.setMinutes(expires.getMinutes() + 30);
expires.setHours(expires.getHours() + 1); 

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_expires_at = $2 WHERE email = $3',
      [token, expires, email]
    );

    await sendResetEmail(email, token);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du lien de réinitialisation.' });
  }
});
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
//   console.log('Received token:'+ token);
  try {
    const userResult = await pool.query(
      'SELECT * FROM users WHERE reset_token = $1 AND reset_expires_at > NOW()',
      [token]
    );
//     console.log('NOW():'+ new Date());
// const test = await pool.query(
//   'SELECT email, reset_expires_at, reset_expires_at > NOW() AS valid FROM users WHERE reset_token = $1',
//   [token]
// );
// console.log('Token check result:'+ JSON.stringify (test.rows));
// console.log('DB query result:'+userResult.rows);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users
       SET password = $1, reset_token = NULL, reset_expires_at = NULL
       WHERE reset_token = $2`,
      [hashedPassword, token]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Register
router.post('/register', async (req, res) => {
  const { email, password, full_name, tel, adresse } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, tel, adresse)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, tel, adresse, plan`,
      [email, hashed, full_name, tel, adresse]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        tel: user.tel,
        adresse: user.adresse,
        image: user.image,
        logo: user.logo,
        matricule_fiscal: user.matricule_fiscal,
        plan: user.plan,
        status: user.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});


module.exports = router;
