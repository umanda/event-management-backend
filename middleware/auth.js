const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);

    if (!admin || !admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Invalid token or account deactivated",
      });
    }

    req.user = {
      id: admin._id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions,
    };

    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// Permission-based access control
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required: ${permission}`,
      });
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  requirePermission,
};
