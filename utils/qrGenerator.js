const QRCode = require("qrcode");

// Generates a random 8-character alphanumeric ID
// This prevents people from guessing participant IDs
function generateParticipantId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Converts participant ID into a scannable QR code
// Returns base64 encoded image data
async function generateQRCode(participantId) {
  try {
    const qrCodeData = await QRCode.toDataURL(participantId, {
      width: 300, // QR code size
      margin: 2, // White border around QR code
      color: {
        dark: "#000000", // Black squares
        light: "#FFFFFF", // White background
      },
    });
    return qrCodeData;
  } catch (error) {
    throw new Error("Failed to generate QR code: " + error.message);
  }
}

module.exports = {
  generateParticipantId,
  generateQRCode,
};
