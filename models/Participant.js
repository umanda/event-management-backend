const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    participantId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    isPlayer: { type: Boolean, default: false },
    qrCode: String,
    foodPreference: {
      type: String,
      enum: ["vegetarian", "chicken", "fish", "mixed", "no-preference"],
      default: "no-preference",
    },
    isPresent: { type: Boolean, default: false },
    attendanceTime: Date,
    attendanceMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    
    // Remove fixed entitlements structure - everything goes to entitlements array
    entitlements: [
      {
        templateId: { type: mongoose.Schema.Types.ObjectId, ref: "EntitlementTemplate", required: true },
        name: { type: String, required: true },
        description: String,
        category: { type: String, required: true },
        isCountable: { type: Boolean, default: false },
        maxCount: { type: Number, default: 1 },
        given: { type: Number, default: 0 }, // Always use number (0/1 for boolean, actual count for countable)
        givenAt: [Date],
        givenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Admin" }],
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        addedAt: { type: Date, default: Date.now },
        undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        undoneAt: Date,
        lastUndoneCount: { type: Number, default: 0 },
      }
    ],

    groups: [
      {
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
        groupName: String,
        addedAt: { type: Date, default: Date.now },
      }
    ],

    typeChangeHistory: [
      {
        previousType: { type: Boolean },
        newType: { type: Boolean },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        changedAt: { type: Date, default: Date.now },
        reason: String,
      }
    ],

    entitlementHistory: [
      {
        entitlementName: String,
        action: { type: String, enum: ["added", "distributed", "undone"] },
        count: { type: Number, default: 1 },
        performedAt: { type: Date, default: Date.now },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
        groupName: String,
      }
    ],
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

module.exports = mongoose.model("Participant", participantSchema);
