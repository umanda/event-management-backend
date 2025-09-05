const mongoose = require("mongoose");

const eventSettingsSchema = new mongoose.Schema({
  settingName: {
    type: String,
    unique: true,
    required: true,
  },
  settingValue: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  description: String,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("EventSettings", eventSettingsSchema);
