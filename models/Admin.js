// models/Admin.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "gate", "food"], default: "food" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    permissions: {
      canMarkAttendance: { type: Boolean, default: false },
      canDistributeFood: { type: Boolean, default: false },
      canUndoActions: { type: Boolean, default: false },
      canManageUsers: { type: Boolean, default: false },
      canManageSettings: { type: Boolean, default: false },
    },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

// Set permissions based on role
adminSchema.pre("save", function (next) {
  if (this.isModified("role")) {
    switch (this.role) {
      case "admin":
        this.permissions = {
          canMarkAttendance: true,
          canDistributeFood: true,
          canUndoActions: true,
          canManageUsers: true,
          canManageSettings: true,
        };
        break;
      case "gate":
        this.permissions = {
          canMarkAttendance: true,
          canDistributeFood: false,
          canUndoActions: false,
          canManageUsers: false,
          canManageSettings: false,
        };
        break;
      case "food":
      default:
        this.permissions = {
          canMarkAttendance: false,
          canDistributeFood: true,
          canUndoActions: false,
          canManageUsers: false,
          canManageSettings: false,
        };
        break;
    }
  }
  next();
});

// Hash password
adminSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    return next();
  } catch (err) {
    return next(err);
  }
});

adminSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);
