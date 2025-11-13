const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const authenticateToken = require('../middleware/authMiddleware');
const axios = require('axios');
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const result = await pool.query(
      `SELECT subscription_type, trial_start, subscription_end, is_blocked 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    const now = new Date();

    if (!user.subscription_type || user.subscription_type === 'trial') {
      const trialStart = user.trial_start ? new Date(user.trial_start) : now;
      const diffDays = Math.floor((now - trialStart) / (1000 * 60 * 60 * 24));
      const daysLeft = Math.max(0, 7 - diffDays);
      const isBlocked = user.is_blocked || daysLeft <= 0;

      return res.json({
        isBlocked,
        type: 'trial',
        daysLeft,
      });
    }

    if (user.subscription_type === 'lifetime') {
      return res.json({
        isBlocked: user.is_blocked,
        type: 'lifetime',
      });
    }

    if (user.subscription_type === 'monthly') {
      const end = user.subscription_end ? new Date(user.subscription_end) : null;
      const expired = end && now > end;
      const isBlocked = user.is_blocked || expired;

      return res.json({
        isBlocked,
        type: 'monthly',
        subscription_end: end ? end.toISOString() : null,
      });
    }

    return res.json({ isBlocked: user.is_blocked || false });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ error: 'Subscription check failed' });
  }
});


router.post('/create-payment', authenticateToken, async (req, res) => {
  const userId = req.userId;
  const { type } = req.body; 

  if (!['monthly', 'lifetime'].includes(type)) {
    return res.status(400).json({ error: 'Invalid subscription type' });
  }


  const amount = type === 'lifetime' ? 150.0 : 15.0;

  try {
    const insert = await pool.query(
      `INSERT INTO payments (user_id, gateway, amount, type, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       RETURNING id`,
      [userId, 'paymee', amount, type, 'pending']
    );

    const localPaymentId = insert.rows[0].id;

    return res.json({
      success: true,
      localPaymentId,
      amount,
      type,
    });
  } catch (err) {
    console.error('create-payment error:', err);
    return res.status(500).json({ error: 'Failed to create payment' });
  }
});
router.post('/initiate', authenticateToken, async (req, res) => {
  const userId = req.userId;
  const { localPaymentId, email, phone } = req.body; 

  try {
    const result = await pool.query(
      `SELECT * FROM payments WHERE id = $1 AND user_id = $2`,
      [localPaymentId, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
console.log("found pay")
    const payment = result.rows[0];
    const PAYMEE_API_KEY = process.env.PAYMEE_API_KEY;
    const callbackUrl = `${process.env.BASE_URL}/api/subscription/paymee-callback`; 

   
    const userResult = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
    const fullName = userResult.rows[0].full_name || 'Client User';
    const [first_name, ...rest] = fullName.split(' ');
    const last_name = rest.join(' ');
console.log("here")
 const paymeeRes = await axios.post(
  'https://sandbox.paymee.tn/api/v2/payments/create',
  {
    amount: Number(payment.amount), 
    note: `Subscription ${payment.type}`,
    first_name,
    last_name,
    email: email || 'user@example.com',
    phone: phone || '+21653123640', 
    success_url: `${process.env.FRONT_URL}/payment/success`,
    fail_url: `${process.env.FRONT_URL}/payment/failure`,
    webhook_url: callbackUrl,
  },
  {
    headers: {
      Authorization: `Token ${PAYMEE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }
);
console.log("paymeeRes",paymeeRes)
    if (!paymeeRes.data || !paymeeRes.data.data) {
      return res.status(500).json({
        error: 'Paymee API did not return expected data',
        rawResponse: paymeeRes.data,
      });
    }

    const { token, payment_url } = paymeeRes.data.data;

 await pool.query(
  `UPDATE payments 
   SET gateway_payment_id = $1, metadata = $2, updated_at = now()
   WHERE id = $3`,
  [token, { token: token }, localPaymentId]
);


    return res.json({ success: true, payment_url });
  } catch (err) {
    console.error('Paymee initiate error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Paymee initiation failed' });
  }
});

router.post('/paymee-callback', async (req, res) => {
  try {
  
    const token = req.body.token || req.query.token;
    const status = req.body.status || req.query.status;

    console.log('Paymee callback body:', req.body); 

    if (!token || !status) {
      return res.status(400).json({ error: 'Missing token or status' });
    }

    const paymentResult = await pool.query(
      `SELECT * FROM payments WHERE metadata->>'token' = $1`,
      [token]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];
    const userId = payment.user_id;

    await pool.query(
      `UPDATE payments 
       SET status = $1, updated_at = now()
       WHERE id = $2`,
      [status === 'paid' ? 'paid' : 'failed', payment.id]
    );
    if (status === 'paid') {
      let subscriptionEnd = null;
      if (payment.type === 'monthly') {
        subscriptionEnd = new Date();
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
      }
      await pool.query(
        `UPDATE users 
         SET subscription_type = $1, subscription_end = $2, is_blocked = false
         WHERE id = $3`,
        [payment.type, subscriptionEnd, userId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Paymee callback error:', err);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});
module.exports = router;
