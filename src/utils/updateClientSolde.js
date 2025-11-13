const pool = require('../db');

async function updateClientSolde(clientId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Get initial balance
    const { rows: clientRows } = await client.query(
      'SELECT solde_ini FROM clients WHERE id = $1 AND user_id = $2',
      [clientId, userId]
    );

    if (clientRows.length === 0) {
      throw new Error(`Client ${clientId} not found for user ${userId}`);
    }

    const soldeIni = parseFloat(clientRows[0].solde_ini) || 0;

    // 2️⃣ Get total unpaid invoices
    const { rows: invoiceRows } = await client.query(
      `SELECT COALESCE(SUM(total_ttc), 0) AS total_unpaid
       FROM invoices
       WHERE client_id = $1
       AND LOWER(payment_status) NOT IN ('payé', 'payée')`,
      [clientId]
    );

    const totalUnpaid = parseFloat(invoiceRows[0].total_unpaid) || 0;
    const newSolde = soldeIni + totalUnpaid;

    // 3️⃣ Update client solde
    await client.query(
      'UPDATE clients SET solde = $1 WHERE id = $2 AND user_id = $3',
      [newSolde, clientId, userId]
    );

    await client.query('COMMIT');
    console.log(`✅ Solde updated for client ${clientId}: ${newSolde} (init=${soldeIni}, unpaid=${totalUnpaid})`);
    return newSolde;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating client solde:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = updateClientSolde;
