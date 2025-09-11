const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    if (!token) {
      return res.status(401).json({
        success: false,
        code: "AUTH_TOKEN_REQUIRED",
        message: "Access token required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);
    if (!admin || !admin.isActive) {
      return res.status(403).json({
        success: false,
        code: "AUTH_INVALID_OR_INACTIVE",
        message: "Invalid token or account deactivated",
      });
    }

    req.user = {
      id: admin._id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions || {},
    };
    return next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      code: "AUTH_INVALID_TOKEN",
      message: "Invalid or expired token",
      details: error.message,
    });
  }
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.permissions || !req.user.permissions[permission]) {
        return res.status(403).json({
          success: false,
          code: "PERMISSION_DENIED",
          message: `Insufficient permissions. Required: ${permission}`,
        });
      }
      return next();
    } catch (error) {
      return res.status(403).json({
        success: false,
        code: "PERMISSION_ERROR",
        message: "Error verifying permissions",
        details: error.message,
      });
    }
  };
};

module.exports = { authenticateToken, requirePermission };
