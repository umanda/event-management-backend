const mongoose = require("mongoose");

const entitlementTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    category: {
      type: String,
      enum: ["food", "beverage", "merchandise", "access", "other"],
      required: true,
    },
    isCountable: { type: Boolean, default: false },
    maxCount: { type: Number, default: 1 },
    defaultForPlayers: { type: Boolean, default: false },
    defaultForParticipants: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

module.exports = mongoose.model("EntitlementTemplate", entitlementTemplateSchema);
