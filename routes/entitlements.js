const express = require("express");
const Participant = require("../models/Participant");
const EntitlementTemplate = require("../models/EntitlementTemplate");
const { authenticateToken, requirePermission } = require("../middleware/auth");

const router = express.Router();

// Get active templates
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const templates = await EntitlementTemplate.find({ isActive: true })
      .populate("createdBy", "username")
      .sort({ category: 1, name: 1 });

    return res.json({ success: true, templates });
  } catch (error) {
    console.error("Get templates error:", error);
    return res.status(500).json({
      success: false,
      code: "GET_TEMPLATES_SERVER_ERROR",
      message: "Error fetching entitlement templates",
      details: error.message,
    });
  }
});

// Create template (admin)
router.post(
  "/templates",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const {
        name,
        description,
        category,
        isCountable,
        maxCount,
        defaultForPlayers,
        defaultForParticipants,
      } = req.body || {};

      if (!name || !category) {
        return res.status(400).json({
          success: false,
          code: "TEMPLATE_VALIDATION",
          message: "Name and category are required",
        });
      }

      const existing = await EntitlementTemplate.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          code: "TEMPLATE_EXISTS",
          message: "Entitlement template with this name already exists",
        });
      }

      const template = new EntitlementTemplate({
        name,
        description,
        category,
        isCountable: !!isCountable,
        maxCount: isCountable ? maxCount || 1 : 1,
        defaultForPlayers: !!defaultForPlayers,
        defaultForParticipants: !!defaultForParticipants,
        createdBy: req.user.id,
      });

      await template.save();

      const populated = await EntitlementTemplate.findById(template._id).populate(
        "createdBy",
        "username"
      );

      return res.json({
        success: true,
        message: "Entitlement template created successfully",
        template: populated,
      });
    } catch (error) {
      console.error("Create template error:", error);
      return res.status(500).json({
        success: false,
        code: "CREATE_TEMPLATE_SERVER_ERROR",
        message: "Error creating entitlement template",
        details: error.message,
      });
    }
  }
);

// Update template (admin)
router.put(
  "/templates/:templateId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const updateData = { ...req.body };

      ["_id", "createdBy", "createdAt", "updatedAt"].forEach((k) => delete updateData[k]);

      const template = await EntitlementTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({
          success: false,
          code: "TEMPLATE_NOT_FOUND",
          message: "Entitlement template not found",
        });
      }

      Object.assign(template, updateData);
      await template.save();

      const populated = await EntitlementTemplate.findById(template._id).populate(
        "createdBy",
        "username"
      );

      return res.json({
        success: true,
        message: "Entitlement template updated successfully",
        template: populated,
      });
    } catch (error) {
      console.error("Update template error:", error);
      return res.status(500).json({
        success: false,
        code: "UPDATE_TEMPLATE_SERVER_ERROR",
        message: "Error updating entitlement template",
        details: error.message,
      });
    }
  }
);

// Deactivate template (admin)
router.delete(
  "/templates/:templateId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { templateId } = req.params;

      const template = await EntitlementTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({
          success: false,
          code: "TEMPLATE_NOT_FOUND",
          message: "Entitlement template not found",
        });
      }

      template.isActive = false;
      await template.save();

      return res.json({
        success: true,
        message: "Entitlement template deactivated successfully",
      });
    } catch (error) {
      console.error("Delete template error:", error);
      return res.status(500).json({
        success: false,
        code: "DELETE_TEMPLATE_SERVER_ERROR",
        message: "Error deleting entitlement template",
        details: error.message,
      });
    }
  }
);

// Initialize fixed entitlements (admin only)
router.post(
  "/initialize-fixed",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const fixedEntitlements = [
        {
          name: "Breakfast",
          description: "Morning breakfast for participants",
          category: "food",
          isCountable: false,
          maxCount: 1,
          defaultForPlayers: true,
          defaultForParticipants: true,
        },
        {
          name: "Lunch",
          description: "Lunch meal for participants",
          category: "food",
          isCountable: false,
          maxCount: 1,
          defaultForPlayers: true,
          defaultForParticipants: true,
        },
        {
          name: "Beer",
          description: "Beer for participants",
          category: "beverage",
          isCountable: true,
          maxCount: 2, // Will be overridden by settings
          defaultForPlayers: true,
          defaultForParticipants: true,
        },
        {
          name: "Soft Drinks",
          description: "Soft drinks for participants",
          category: "beverage",
          isCountable: true,
          maxCount: 3, // Will be overridden by settings
          defaultForPlayers: true,
          defaultForParticipants: true,
        },
        {
          name: "Evening Refreshment",
          description: "Evening refreshments for participants",
          category: "food",
          isCountable: false,
          maxCount: 1,
          defaultForPlayers: true,
          defaultForParticipants: true,
        },
      ];

      const results = [];
      for (const entitlementData of fixedEntitlements) {
        const existing = await EntitlementTemplate.findOne({
          name: { $regex: new RegExp(`^${entitlementData.name}$`, "i") },
        });

        if (!existing) {
          const template = new EntitlementTemplate({
            ...entitlementData,
            createdBy: req.user.id,
          });
          await template.save();
          results.push(template);
        }
      }

      return res.json({
        success: true,
        message: `${results.length} fixed entitlements initialized`,
        templates: results,
      });
    } catch (error) {
      console.error("Initialize fixed entitlements error:", error);
      return res.status(500).json({
        success: false,
        code: "INITIALIZE_FIXED_SERVER_ERROR",
        message: "Error initializing fixed entitlements",
        details: error.message,
      });
    }
  }
);

// Add entitlement to participant (admin)
router.post(
  "/participant/:participantId/add",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantId } = req.params;
      const { templateId, customMaxCount } = req.body || {};

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          code: "PARTICIPANT_NOT_FOUND",
          message: "Participant not found",
        });
      }

      const template = await EntitlementTemplate.findById(templateId);
      if (!template || !template.isActive) {
        return res.status(404).json({
          success: false,
          code: "TEMPLATE_NOT_FOUND_OR_INACTIVE",
          message: "Entitlement template not found or inactive",
        });
      }

      const existing = participant.entitlements.find(
        (ent) => ent.name.toLowerCase() === template.name.toLowerCase()
      );

      if (existing) {
        return res.status(400).json({
          success: false,
          code: "ENTITLEMENT_ALREADY_EXISTS",
          message: "Participant already has this entitlement",
        });
      }

      participant.entitlements.push({
        templateId: template._id,
        name: template.name,
        description: template.description,
        category: template.category,
        isCountable: template.isCountable,
        maxCount: template.isCountable ? customMaxCount || template.maxCount : 1,
        given: 0,
        givenAt: [],
        givenBy: [],
        addedBy: req.user.id,
        addedAt: new Date(),
      });

      await participant.save();

      return res.json({
        success: true,
        message: `Entitlement "${template.name}" added to participant`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          entitlements: participant.entitlements,
        },
      });
    } catch (error) {
      console.error("Add entitlement error:", error);
      return res.status(500).json({
        success: false,
        code: "ADD_ENTITLEMENT_SERVER_ERROR",
        message: "Error adding entitlement to participant",
        details: error.message,
      });
    }
  }
);

// Remove entitlement from participant (admin)
router.delete(
  "/participant/:participantId/remove/:entitlementName",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantId, entitlementName } = req.params;

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          code: "PARTICIPANT_NOT_FOUND",
          message: "Participant not found",
        });
      }

      const index = participant.entitlements.findIndex(
        (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
      );

      if (index === -1) {
        return res.status(404).json({
          success: false,
          code: "ENTITLEMENT_NOT_FOUND",
          message: "Entitlement not found for this participant",
        });
      }

      participant.entitlements.splice(index, 1);
      await participant.save();

      return res.json({
        success: true,
        message: `Entitlement "${entitlementName}" removed from participant`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          entitlements: participant.entitlements,
        },
      });
    } catch (error) {
      console.error("Remove entitlement error:", error);
      return res.status(500).json({
        success: false,
        code: "REMOVE_ENTITLEMENT_SERVER_ERROR",
        message: "Error removing entitlement from participant",
        details: error.message,
      });
    }
  }
);

// Distribute entitlement
router.post(
  "/participant/:participantId/distribute",
  authenticateToken,
  requirePermission("canDistributeFood"),
  async (req, res) => {
    try {
      const { participantId } = req.params;
      const { entitlementName, count = 1 } = req.body || {};

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          code: "PARTICIPANT_NOT_FOUND",
          message: "Participant not found",
        });
      }

      if (!participant.isPresent) {
        return res.status(400).json({
          success: false,
          code: "PARTICIPANT_NOT_PRESENT",
          message: "Participant must be marked present first",
        });
      }

      const entitlement = participant.entitlements.find(
        (ent) => ent.name.toLowerCase() === String(entitlementName || "").toLowerCase()
      );

      if (!entitlement) {
        return res.status(404).json({
          success: false,
          code: "ENTITLEMENT_NOT_FOUND",
          message: "Entitlement not found for this participant",
        });
      }

      const requestedCount = parseInt(count);

      if (entitlement.isCountable) {
        if (entitlement.given + requestedCount > entitlement.maxCount) {
          return res.status(400).json({
            success: false,
            code: "ENTITLEMENT_LIMIT_EXCEEDED",
            message: `Entitlement limit exceeded. Current: ${entitlement.given}, Limit: ${entitlement.maxCount}, Requested: ${requestedCount}`,
          });
        }

        entitlement.given += requestedCount;
        for (let i = 0; i < requestedCount; i++) {
          entitlement.givenAt.push(new Date());
          entitlement.givenBy.push(req.user.id);
        }
      } else {
        if (entitlement.given >= entitlement.maxCount) {
          return res.status(400).json({
            success: false,
            code: "ENTITLEMENT_ALREADY_GIVEN",
            message: "Entitlement already given",
          });
        }

        entitlement.given = entitlement.maxCount;
        entitlement.givenAt.push(new Date());
        entitlement.givenBy.push(req.user.id);
      }

      await participant.save();

      return res.json({
        success: true,
        message: `${entitlementName} distributed successfully${
          entitlement.isCountable ? ` (count: ${requestedCount})` : ""
        }`,
        entitlement,
      });
    } catch (error) {
      console.error("Distribute entitlement error:", error);
      return res.status(500).json({
        success: false,
        code: "ENTITLEMENT_DISTRIBUTE_SERVER_ERROR",
        message: "Error distributing entitlement",
        details: error.message,
      });
    }
  }
);

// Undo entitlement distribution
router.delete(
  "/participant/:participantId/undo/:entitlementName",
  authenticateToken,
  requirePermission("canUndoActions"),
  async (req, res) => {
    try {
      const { participantId, entitlementName } = req.params;
      const { count = 1 } = req.body || {};

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          code: "PARTICIPANT_NOT_FOUND",
          message: "Participant not found",
        });
      }

      const entitlement = participant.entitlements.find(
        (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
      );

      if (!entitlement) {
        return res.status(404).json({
          success: false,
          code: "ENTITLEMENT_NOT_FOUND",
          message: "Entitlement not found for this participant",
        });
      }

      if (entitlement.given === 0) {
        return res.status(400).json({
          success: false,
          code: "ENTITLEMENT_NOTHING_TO_UNDO",
          message: "No distributions to undo for this entitlement",
        });
      }

      const undoCount = Math.min(parseInt(count), entitlement.given);

      if (entitlement.isCountable) {
        entitlement.given -= undoCount;
        entitlement.givenAt.splice(-undoCount, undoCount);
        entitlement.givenBy.splice(-undoCount, undoCount);
      } else {
        entitlement.given = 0;
        entitlement.givenAt = [];
        entitlement.givenBy = [];
      }

      entitlement.undoneBy = req.user.id;
      entitlement.undoneAt = new Date();
      entitlement.lastUndoneCount = undoCount;

      await participant.save();

      return res.json({
        success: true,
        message: `${entitlementName} distribution undone successfully (count: ${undoCount})`,
        entitlement,
      });
    } catch (error) {
      console.error("Undo entitlement error:", error);
      return res.status(500).json({
        success: false,
        code: "ENTITLEMENT_UNDO_SERVER_ERROR",
        message: "Error undoing entitlement distribution",
        details: error.message,
      });
    }
  }
);

module.exports = router;
