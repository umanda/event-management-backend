const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  // Unique identifier for each participant (used in QR codes)
  participantId: {
    type: String,
    unique: true,
    required: true,
  },

  // Basic participant information
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
  },

  // Distinguishes between regular participants and players
  isPlayer: {
    type: Boolean,
    default: false,
  },

  // Base64 encoded QR code image
  qrCode: {
    type: String,
  },

  // Food preferences
  foodPreference: {
    type: String,
    enum: ["vegetarian", "chicken", "fish", "mixed", "no-preference"],
    default: "no-preference",
  },

  // Attendance tracking
  isPresent: {
    type: Boolean,
    default: false,
  },
  attendanceTime: {
    type: Date,
  },
  attendanceMarkedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
  },

  // Fixed meal and beverage entitlements tracking
  entitlements: {
    breakfast: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
    },
    lunch: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
    },
    beer: {
      given: { type: Number, default: 0 }, // Count for beer
      givenAt: [Date], // Array to track each beer distribution time
      givenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Admin" }], // Array to track who gave each beer
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
      lastUndoneCount: { type: Number, default: 0 },
    },
    eveningMeal: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
    },
    // Special items only for players
    specialBeverage: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
    },
    specialMeal: {
      given: { type: Boolean, default: false },
      givenAt: Date,
      givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
    },
  },

  // Dynamic custom entitlements that admin can add/remove
  customEntitlements: [
    {
      name: { type: String, required: true },
      description: String,
      category: {
        type: String,
        enum: ["food", "beverage", "merchandise", "access", "other"],
        default: "other",
      },
      isCountable: { type: Boolean, default: false }, // true for items like beer, false for meals
      maxCount: { type: Number, default: 1 },
      given: { type: Number, default: 0 }, // Count for countable items, 0/1 for boolean items
      givenAt: [Date],
      givenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Admin" }],
      addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      addedAt: { type: Date, default: Date.now },
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
      lastUndoneCount: { type: Number, default: 0 },
    },
  ],

  // Group membership tracking
  groups: [
    {
      groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
      },
      groupName: String,
      addedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  // Track participant type changes
  typeChangeHistory: [
    {
      previousType: { type: Boolean }, // true for player, false for participant
      newType: { type: Boolean },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      changedAt: { type: Date, default: Date.now },
      reason: String,
    },
  ],

  // Track group entitlement distributions
  groupEntitlementHistory: [
    {
      groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
      groupName: String,
      entitlementName: String,
      entitlementType: { type: String, enum: ["fixed", "custom"] }, // fixed = breakfast/lunch/beer, custom = custom entitlements
      count: { type: Number, default: 1 },
      distributedAt: { type: Date, default: Date.now },
      distributedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
      undoneAt: Date,
      undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Participant", participantSchema);
