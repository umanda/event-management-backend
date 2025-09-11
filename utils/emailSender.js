const nodemailer = require("nodemailer");

// Creates email transporter using SMTP - FIXED: createTransport not createTransporter
const createTransporter = () => {
  return nodemailer.createTransport({  // Fixed function name here
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false, // Use STARTTLS instead of direct SSL
    requireTLS: true, // Force TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false, // Accept self-signed certificates
    },
  });
};

// Sends QR code to participant via email with enhanced professional template
const sendQRCodeEmail = async (participantData, qrCodeData) => {
  try {
    const transporter = createTransporter();

    // Convert base64 QR code to attachment
    const qrCodeBuffer = Buffer.from(qrCodeData.split(",")[1], "base64");

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Boundary Bash - 2025</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f5f7fa;
                color: #333333;
                line-height: 1.6;
                font-size: 14px;
            }
            
            .email-container {
                max-width: 600px;
                margin: 20px auto;
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }
            
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 30px 40px;
                text-align: center;
                color: white;
            }
            
            .header h1 {
                font-size: 24px;
                font-weight: 600;
                margin-bottom: 8px;
            }
            
            .header p {
                font-size: 14px;
                opacity: 0.9;
            }
            
            .content {
                padding: 40px;
            }
            
            .greeting {
                font-size: 16px;
                margin-bottom: 20px;
                color: #2c3e50;
            }
            
            .message {
                margin-bottom: 25px;
                color: #555555;
            }
            
            .details-box {
                background: #f8f9fa;
                border-left: 4px solid #667eea;
                padding: 20px;
                margin: 25px 0;
                border-radius: 6px;
            }
            
            .details-box h3 {
                color: #2c3e50;
                font-size: 15px;
                margin-bottom: 12px;
                font-weight: 600;
            }
            
            .details-list {
                list-style: none;
            }
            
            .details-list li {
                padding: 4px 0;
                color: #555555;
            }
            
            .details-list strong {
                color: #2c3e50;
                min-width: 120px;
                display: inline-block;
            }
            
            .important-notice {
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                border-radius: 6px;
                padding: 20px;
                margin: 25px 0;
            }
            
            .important-notice p {
                color: #856404;
                margin-bottom: 15px;
            }
            
            .form-button {
                display: inline-block;
                background: #e17055;
                color: white !important;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 6px;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.3s ease;
                border: none;
                cursor: pointer;
            }
            
            .form-button:hover {
                background: #d63031;
                transform: translateY(-1px);
                box-shadow: 0 4px 8px rgba(209, 48, 49, 0.3);
            }
            
            .qr-section {
                text-align: center;
                margin: 30px 0;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
            }
            
            .qr-section p {
                color: #555555;
                margin-bottom: 10px;
                font-size: 13px;
            }
            
            .footer {
                background: #f8f9fa;
                padding: 25px 40px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
            
            .footer p {
                color: #6c757d;
                font-size: 12px;
                margin-bottom: 8px;
            }
            
            .footer .event-info {
                color: #495057;
                font-weight: 500;
            }
            
            .divider {
                height: 1px;
                background: linear-gradient(to right, transparent, #dee2e6, transparent);
                margin: 25px 0;
            }
            
            @media (max-width: 600px) {
                .email-container {
                    margin: 10px;
                }
                
                .content, .header, .footer {
                    padding: 20px;
                }
                
                .header h1 {
                    font-size: 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>🏏 Orfium Boundary Bash - 2025</h1>
                <p>Your Cricket Event Registration Confirmation</p>
            </div>
            
            <div class="content">
                <div class="greeting">
                    Dear ${participantData.name},
                </div>
                
                <div class="message">
                    <p>Thank you for registering for <strong>Orfium Boundary Bash - 2025</strong>! We're excited to have you as part of this amazing cricket event.</p>
                    <p>Your registration has been confirmed and your unique QR code is attached to this email.</p>
                </div>
                
                <div class="details-box">
                    <h3>📋 Your Registration Details</h3>
                    <ul class="details-list">
                        <li><strong>Participant ID:</strong> ${participantData.participantId}</li>
                        <li><strong>Name:</strong> ${participantData.name}</li>
                        <li><strong>Registration Type:</strong> ${participantData.isPlayer ? "Player" : "Participant"}</li>
                        <li><strong>Email:</strong> ${participantData.email}</li>
                    </ul>
                </div>
                
                <div class="qr-section">
                    <p><strong>📱 Your QR Code</strong></p>
                    <p>Please present this QR code at the event for quick check-in</p>
                </div>
                
                <div class="divider"></div>
                
                <div class="important-notice">
                    <p><strong>⚠️ Important Notice:</strong></p>
                    <p>If you are unable to attend the event, kindly complete the form linked below to confirm your non-attendance before 12th Friday 3.00 p.m. This will help us plan the event arrangements more effectively.</p>
                    <div style="text-align: center; margin-top: 15px;">
                        <a href="https://docs.google.com/forms/d/e/1FAIpQLScy9roie-bIhC5Q8O7IYvpEb3ERtEa8y2WBkb9PHv5zeJnYxw/viewform?usp=dialog" class="form-button">
                            📝 Confirm Non-Attendance
                        </a>
                    </div>
                </div>
                
                <div class="message">
                    <p>We look forward to seeing you at Boundary Bash - 2025!</p>
                    <p>If you have any questions, please don't hesitate to contact us.</p>
                </div>
            </div>
            
            <div class="footer">
                <p class="event-info">Boundary Bash - 2025</p>
                <p>&copy; 2025 Boundary Bash Event Management. All rights reserved.</p>
                <p>This is an automated message, please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
      from: {
        name: process.env.APP_NAME || "Boundary Bash - 2025",
        address: process.env.EMAIL_USER,
      },
      to: participantData.email,
      subject: "🏏 Orfium Boundary Bash - 2025 | Your QR Code & Registration Details",
      html: htmlContent,
      attachments: [
        {
          filename: `${participantData.participantId}_QRCode.png`,
          content: qrCodeBuffer,
          cid: 'qrcode', // Used to reference in HTML if needed
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
};

// Test email configuration
const testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    return { success: true };
  } catch (error) {
    console.error('SMTP verification failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  createTransporter,
  sendQRCodeEmail,
  testEmailConfig,
};
