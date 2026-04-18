import nodemailer from 'nodemailer';
import { config } from '../config.js';
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: config.GMAIL_USER,
        pass: config.GMAIL_PASSWORD,
    },
});
const recipients = config.ALERT_RECIPIENTS.split(',').map((s) => s.trim());
export async function sendWarningDigest(warnings, products) {
    await transporter.sendMail({
        from: `"Eiwitten Mailer" <${config.GMAIL_USER}>`,
        to: recipients,
        subject: `(${warnings.length}) Products not found after scrape`,
        html: buildDigestHtml(warnings, products),
    });
}
export async function sendErrorAlert(message) {
    await transporter.sendMail({
        from: `"Eiwitten Mailer" <${config.GMAIL_USER}>`,
        to: recipients,
        subject: 'ERROR: Eiwitten scraper',
        html: `<p>${message}</p>`,
    });
}
function buildDigestHtml(warnings, products) {
    const warningRows = warnings
        .sort((a, b) => b.severity - a.severity) // most-clicked first
        .map((w) => `<tr>
          <td>${w.name}</td>
          <td>€${w.price}</td>
          <td>${w.severity} clicks</td>
          <td><a href="${w.url}">View</a></td>
        </tr>`)
        .join('');
    const provisionalProducts = products.filter((p) => p.provisional_price != null);
    const provisionalSection = provisionalProducts.length > 0
        ? `<h2>Security alerts — provisional prices held (${provisionalProducts.length})</h2>
         <table border="1" cellpadding="4">
           <tr><th>Product</th><th>Held price</th><th>Flagged price</th></tr>
           ${provisionalProducts
            .map((p) => `<tr><td>${p.name}</td><td>€${p.price}</td><td>€${p.provisional_price}</td></tr>`)
            .join('')}
         </table>
         <p><a href="https://dashboard.gieriggroeien.nl/verify-provisional-prices">
           Verify provisional prices →
         </a></p>`
        : '';
    return `
    <h2>Products with warnings (${warnings.length})</h2>
    <table border="1" cellpadding="4">
      <tr><th>Product</th><th>Price</th><th>Severity</th><th>Link</th></tr>
      ${warningRows}
    </table>
    ${provisionalSection}
  `;
}
//# sourceMappingURL=email.js.map