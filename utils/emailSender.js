const nodemailer = require("nodemailer");

// Creates email transporter using Gmail SMTP
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false, // Use STARTTLS instead of direct SSL
    requireTLS: true, // Force TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      ciphers: "SSLv3",
    },
  });
};

// Sends QR code to participant via email
const sendQRCodeEmail = async (participantData, qrCodeData) => {
  try {
    const transporter = createTransporter();

    // Convert base64 QR code to attachment
    const qrCodeBuffer = Buffer.from(qrCodeData.split(",")[1], "base64");

    const mailOptions = {
      from: {
        name: process.env.APP_NAME || "Cricket Event Manager",
        address: process.env.EMAIL_USER,
      },
      to: participantData.email,
      subject: "Cricket Event - Your QR Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Cricket Event!</h2>
          <p>Dear ${participantData.name},</p>
          <p>Thank you for registering. Your QR code is attached.</p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Important Instructions:</h3>
            <ul>
              <li>Save this QR code on your phone</li>
              <li>Show at entrance for attendance</li>
              <li>Use for meal distribution</li>
              <li>Do not share with others</li>
            </ul>
          </div>
          
          <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px;">
            <p><strong>Your Details:</strong></p>
            <p>Participant ID: ${participantData.participantId}</p>
            <p>Name: ${participantData.name}</p>
            <p>Type: ${participantData.isPlayer ? "Player" : "Participant"}</p>
          </div>
          
          <p>See you at the event!</p>
        </div>
      `,
      attachments: [
        {
          filename: `qr-code-${participantData.participantId}.png`,
          content: qrCodeBuffer,
          contentType: "image/png",
        },
      ],
    };

    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("Email sending error:", error);
    return { success: false, error: error.message };
  }
};

// Test email configuration
const testEmailConfig = async () => {
  try {
    console.log("Testing email configuration...");
    console.log("EMAIL_HOST:", process.env.EMAIL_HOST);
    console.log("EMAIL_PORT:", process.env.EMAIL_PORT);
    console.log("EMAIL_USER:", process.env.EMAIL_USER);
    console.log("EMAIL_SECURE:", process.env.EMAIL_SECURE);

    const transporter = createTransporter();
    await transporter.verify();
    console.log("✅ Email configuration verified successfully");
    return { success: true };
  } catch (error) {
    console.error("❌ Email configuration error:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendQRCodeEmail,
  testEmailConfig,
};
