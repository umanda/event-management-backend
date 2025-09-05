const express = require("express");
const EventSettings = require("../models/EventSettings");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Get all settings
router.get("/", authenticateToken, async (req, res) => {
  try {
    const settings = await EventSettings.find()
      .populate("updatedBy", "username")
      .sort({ settingName: 1 });

    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching settings",
    });
  }
});

// Get specific setting
router.get("/:settingName", authenticateToken, async (req, res) => {
  try {
    const setting = await EventSettings.findOne({
      settingName: req.params.settingName,
    }).populate("updatedBy", "username");

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: "Setting not found",
      });
    }

    res.json({
      success: true,
      setting,
    });
  } catch (error) {
    console.error("Get setting error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching setting",
    });
  }
});

// Update setting (admin only)
router.put(
  "/:settingName",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { settingValue, description } = req.body;

      if (settingValue === undefined) {
        return res.status(400).json({
          success: false,
          message: "settingValue is required",
        });
      }

      const setting = await EventSettings.findOneAndUpdate(
        { settingName: req.params.settingName },
        {
          settingValue,
          description,
          updatedBy: req.user.id,
          updatedAt: new Date(),
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      ).populate("updatedBy", "username");

      res.json({
        success: true,
        message: "Setting updated successfully",
        setting,
      });
    } catch (error) {
      console.error("Update setting error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating setting",
      });
    }
  }
);

// Initialize default settings
router.post(
  "/initialize",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const defaultSettings = [
        {
          settingName: "beerLimit",
          settingValue: 2,
          description: "Maximum number of beers per participant",
          updatedBy: req.user.id,
        },
        {
          settingName: "eventName",
          settingValue: "Cricket Championship 2024",
          description: "Name of the cricket event",
          updatedBy: req.user.id,
        },
        {
          settingName: "eventDate",
          settingValue: new Date().toISOString().split("T")[0],
          description: "Date of the cricket event",
          updatedBy: req.user.id,
        },
      ];

      const results = [];
      for (const setting of defaultSettings) {
        const existing = await EventSettings.findOne({
          settingName: setting.settingName,
        });
        if (!existing) {
          const newSetting = new EventSettings(setting);
          await newSetting.save();
          results.push(newSetting);
        }
      }

      res.json({
        success: true,
        message: `${results.length} default settings initialized`,
        settings: results,
      });
    } catch (error) {
      console.error("Initialize settings error:", error);
      res.status(500).json({
        success: false,
        message: "Error initializing settings",
      });
    }
  }
);

module.exports = router;
