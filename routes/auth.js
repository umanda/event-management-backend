const express = require("express");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const { testEmailConfig } = require("../utils/emailSender");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Admin login endpoint
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const admin = await Admin.findOne({ username, isActive: true });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials or account deactivated",
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        permissions: admin.permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        permissions: admin.permissions,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// Create initial admin (use once)
router.post("/create-admin", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this username already exists",
      });
    }

    const admin = new Admin({
      username,
      password,
      role: "admin",
    });

    await admin.save();

    res.json({
      success: true,
      message: "Admin created successfully",
      admin: {
        username: admin.username,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Create admin error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating admin",
    });
  }
});

// Create new user (only admin)
router.post(
  "/create-user",
  authenticateToken,
  requirePermission("canManageUsers"),
  async (req, res) => {
    try {
      const { username, password, role } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({
          success: false,
          message: "Username, password, and role are required",
        });
      }

      if (!["gate", "food"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Role must be either "gate" or "food"',
        });
      }

      const existingUser = await Admin.findOne({ username });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User with this username already exists",
        });
      }

      const user = new Admin({
        username,
        password,
        role,
        createdBy: req.user.id,
      });

      await user.save();

      res.json({
        success: true,
        message: "User created successfully",
        user: {
          id: user._id,
          username: user.username,
          role: user.role,
          permissions: user.permissions,
          isActive: user.isActive,
        },
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({
        success: false,
        message: "Error creating user",
      });
    }
  }
);

// Get all users (only admin)
router.get(
  "/users",
  authenticateToken,
  requirePermission("canManageUsers"),
  async (req, res) => {
    try {
      const users = await Admin.find({ role: { $ne: "admin" } })
        .populate("createdBy", "username")
        .select("-password")
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        users,
      });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching users",
      });
    }
  }
);

// Update user status (only admin)
router.patch(
  "/users/:userId/status",
  authenticateToken,
  requirePermission("canManageUsers"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      const user = await Admin.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.role === "admin") {
        return res.status(403).json({
          success: false,
          message: "Cannot modify admin users",
        });
      }

      user.isActive = isActive;
      await user.save();

      res.json({
        success: true,
        message: `User ${isActive ? "activated" : "deactivated"} successfully`,
        user: {
          id: user._id,
          username: user.username,
          role: user.role,
          isActive: user.isActive,
        },
      });
    } catch (error) {
      console.error("Update user status error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating user status",
      });
    }
  }
);

// Test email configuration
router.post("/test-email", authenticateToken, async (req, res) => {
  try {
    const result = await testEmailConfig();

    res.json({
      success: result.success,
      message: result.success
        ? "Email configuration is working"
        : "Email configuration failed",
      error: result.error,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error testing email configuration",
    });
  }
});

module.exports = router;
