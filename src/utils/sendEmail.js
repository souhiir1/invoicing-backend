const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendResetEmail(to, token) {
  const resetUrl = `${process.env.FRONT_URL}/reset-password?token=${token}`; 
  const html = `
    <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
    <p>Voici votre lien : <a href="${resetUrl}">${resetUrl}</a></p>
    <p>Ce lien expirera dans 30 minutes.</p>
  `;

  await transporter.sendMail({
    from: `"InovaSphere" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Réinitialisation de mot de passe',
    html,
  });
}

module.exports = sendResetEmail;