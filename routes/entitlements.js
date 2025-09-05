const express = require("express");
const Participant = require("../models/Participant");
const EntitlementTemplate = require("../models/EntitlementTemplate");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Get all entitlement templates
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const templates = await EntitlementTemplate.find({ isActive: true })
      .populate("createdBy", "username")
      .sort({ category: 1, name: 1 });

    res.json({
      success: true,
      templates,
    });
  } catch (error) {
    console.error("Get templates error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching entitlement templates",
    });
  }
});

// Create entitlement template (admin only)
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
      } = req.body;

      if (!name || !category) {
        return res.status(400).json({
          success: false,
          message: "Name and category are required",
        });
      }

      const existingTemplate = await EntitlementTemplate.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
      });
      if (existingTemplate) {
        return res.status(400).json({
          success: false,
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

      const populatedTemplate = await EntitlementTemplate.findById(
        template._id
      ).populate("createdBy", "username");

      res.json({
        success: true,
        message: "Entitlement template created successfully",
        template: populatedTemplate,
      });
    } catch (error) {
      console.error("Create template error:", error);
      res.status(500).json({
        success: false,
        message: "Error creating entitlement template",
      });
    }
  }
);

// Update entitlement template (admin only)
router.put(
  "/templates/:templateId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const updateData = req.body;
      delete updateData._id;
      delete updateData.createdBy;
      delete updateData.createdAt;

      const template = await EntitlementTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({
          success: false,
          message: "Entitlement template not found",
        });
      }

      Object.assign(template, updateData);
      await template.save();

      const populatedTemplate = await EntitlementTemplate.findById(
        template._id
      ).populate("createdBy", "username");

      res.json({
        success: true,
        message: "Entitlement template updated successfully",
        template: populatedTemplate,
      });
    } catch (error) {
      console.error("Update template error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating entitlement template",
      });
    }
  }
);

// Delete entitlement template (admin only)
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
          message: "Entitlement template not found",
        });
      }

      template.isActive = false;
      await template.save();

      res.json({
        success: true,
        message: "Entitlement template deactivated successfully",
      });
    } catch (error) {
      console.error("Delete template error:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting entitlement template",
      });
    }
  }
);

// Add entitlement to participant (admin only)
router.post(
  "/participant/:participantId/add",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantId } = req.params;
      const { templateId, customMaxCount } = req.body;

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      const template = await EntitlementTemplate.findById(templateId);
      if (!template || !template.isActive) {
        return res.status(404).json({
          success: false,
          message: "Entitlement template not found or inactive",
        });
      }

      // Check if entitlement already exists
      const existingEntitlement = participant.customEntitlements.find(
        (ent) => ent.name.toLowerCase() === template.name.toLowerCase()
      );

      if (existingEntitlement) {
        return res.status(400).json({
          success: false,
          message: "Participant already has this entitlement",
        });
      }

      // Add entitlement to participant
      participant.customEntitlements.push({
        name: template.name,
        description: template.description,
        category: template.category,
        isCountable: template.isCountable,
        maxCount: customMaxCount || template.maxCount,
        given: 0,
        givenAt: [],
        givenBy: [],
        addedBy: req.user.id,
        addedAt: new Date(),
      });

      await participant.save();

      res.json({
        success: true,
        message: `Entitlement "${template.name}" added to participant`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          customEntitlements: participant.customEntitlements,
        },
      });
    } catch (error) {
      console.error("Add entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error adding entitlement to participant",
      });
    }
  }
);

// Remove entitlement from participant (admin only)
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
          message: "Participant not found",
        });
      }

      const entitlementIndex = participant.customEntitlements.findIndex(
        (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
      );

      if (entitlementIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Entitlement not found for this participant",
        });
      }

      // Remove entitlement
      participant.customEntitlements.splice(entitlementIndex, 1);
      await participant.save();

      res.json({
        success: true,
        message: `Entitlement "${entitlementName}" removed from participant`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          customEntitlements: participant.customEntitlements,
        },
      });
    } catch (error) {
      console.error("Remove entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error removing entitlement from participant",
      });
    }
  }
);

// Bulk add entitlement to multiple participants (admin only)
router.post(
  "/bulk/add",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantIds, templateId, customMaxCount } = req.body;

      if (!Array.isArray(participantIds) || !templateId) {
        return res.status(400).json({
          success: false,
          message: "participantIds array and templateId are required",
        });
      }

      const template = await EntitlementTemplate.findById(templateId);
      if (!template || !template.isActive) {
        return res.status(404).json({
          success: false,
          message: "Entitlement template not found or inactive",
        });
      }

      const results = [];
      const errors = [];

      for (const participantId of participantIds) {
        try {
          const participant = await Participant.findOne({ participantId });

          if (!participant) {
            errors.push(`${participantId}: Participant not found`);
            continue;
          }

          // Check if entitlement already exists
          const existingEntitlement = participant.customEntitlements.find(
            (ent) => ent.name.toLowerCase() === template.name.toLowerCase()
          );

          if (existingEntitlement) {
            errors.push(`${participantId}: Already has this entitlement`);
            continue;
          }

          // Add entitlement
          participant.customEntitlements.push({
            name: template.name,
            description: template.description,
            category: template.category,
            isCountable: template.isCountable,
            maxCount: customMaxCount || template.maxCount,
            given: 0,
            givenAt: [],
            givenBy: [],
            addedBy: req.user.id,
            addedAt: new Date(),
          });

          await participant.save();

          results.push({
            participantId,
            name: participant.name,
            success: true,
          });
        } catch (error) {
          errors.push(`${participantId}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Bulk entitlement addition completed. ${results.length} participants updated.`,
        results,
        errors,
      });
    } catch (error) {
      console.error("Bulk add entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error in bulk entitlement addition",
      });
    }
  }
);

// Distribute custom entitlement
router.post(
  "/participant/:participantId/distribute",
  authenticateToken,
  requirePermission("canDistributeFood"),
  async (req, res) => {
    try {
      const { participantId } = req.params;
      const { entitlementName, count = 1 } = req.body;

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (!participant.isPresent) {
        return res.status(400).json({
          success: false,
          message: "Participant must be marked present first",
        });
      }

      const entitlement = participant.customEntitlements.find(
        (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
      );

      if (!entitlement) {
        return res.status(404).json({
          success: false,
          message: "Entitlement not found for this participant",
        });
      }

      const requestedCount = parseInt(count);

      if (entitlement.isCountable) {
        // Countable entitlement
        if (entitlement.given + requestedCount > entitlement.maxCount) {
          return res.status(400).json({
            success: false,
            message: `Entitlement limit exceeded. Current: ${entitlement.given}, Limit: ${entitlement.maxCount}, Requested: ${requestedCount}`,
          });
        }

        entitlement.given += requestedCount;

        // Track each distribution
        for (let i = 0; i < requestedCount; i++) {
          entitlement.givenAt.push(new Date());
          entitlement.givenBy.push(req.user.id);
        }
      } else {
        // Boolean entitlement
        if (entitlement.given >= entitlement.maxCount) {
          return res.status(400).json({
            success: false,
            message: "Entitlement already given",
          });
        }

        entitlement.given = entitlement.maxCount;
        entitlement.givenAt.push(new Date());
        entitlement.givenBy.push(req.user.id);
      }

      await participant.save();

      res.json({
        success: true,
        message: `${entitlementName} distributed successfully${
          entitlement.isCountable ? ` (count: ${requestedCount})` : ""
        }`,
        entitlement,
      });
    } catch (error) {
      console.error("Distribute entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error distributing entitlement",
      });
    }
  }
);

// Undo custom entitlement distribution (admin only)
router.delete(
  "/participant/:participantId/undo/:entitlementName",
  authenticateToken,
  requirePermission("canUndoActions"),
  async (req, res) => {
    try {
      const { participantId, entitlementName } = req.params;
      const { count = 1 } = req.body;

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      const entitlement = participant.customEntitlements.find(
        (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
      );

      if (!entitlement) {
        return res.status(404).json({
          success: false,
          message: "Entitlement not found for this participant",
        });
      }

      const undoCount = Math.min(parseInt(count), entitlement.given);

      if (entitlement.given === 0) {
        return res.status(400).json({
          success: false,
          message: "No distributions to undo for this entitlement",
        });
      }

      if (entitlement.isCountable) {
        // Countable entitlement
        entitlement.given -= undoCount;

        // Remove last entries from tracking arrays
        entitlement.givenAt.splice(-undoCount, undoCount);
        entitlement.givenBy.splice(-undoCount, undoCount);
      } else {
        // Boolean entitlement
        entitlement.given = 0;
        entitlement.givenAt = [];
        entitlement.givenBy = [];
      }

      entitlement.undoneBy = req.user.id;
      entitlement.undoneAt = new Date();
      entitlement.lastUndoneCount = undoCount;

      await participant.save();

      res.json({
        success: true,
        message: `${entitlementName} distribution undone successfully (count: ${undoCount})`,
        entitlement,
      });
    } catch (error) {
      console.error("Undo entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error undoing entitlement distribution",
      });
    }
  }
);

// Auto-assign entitlements based on templates
router.post(
  "/auto-assign",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantType } = req.body; // 'players', 'participants', or 'all'

      let filter = {};
      if (participantType === "players") {
        filter.isPlayer = true;
      } else if (participantType === "participants") {
        filter.isPlayer = false;
      }

      const participants = await Participant.find(filter);
      const templates = await EntitlementTemplate.find({ isActive: true });

      const results = [];
      const errors = [];

      for (const participant of participants) {
        try {
          let addedCount = 0;

          for (const template of templates) {
            // Check if should auto-assign
            const shouldAssign =
              (participant.isPlayer && template.defaultForPlayers) ||
              (!participant.isPlayer && template.defaultForParticipants);

            if (!shouldAssign) continue;

            // Check if already has this entitlement
            const existingEntitlement = participant.customEntitlements.find(
              (ent) => ent.name.toLowerCase() === template.name.toLowerCase()
            );

            if (existingEntitlement) continue;

            // Add entitlement
            participant.customEntitlements.push({
              name: template.name,
              description: template.description,
              category: template.category,
              isCountable: template.isCountable,
              maxCount: template.maxCount,
              given: 0,
              givenAt: [],
              givenBy: [],
              addedBy: req.user.id,
              addedAt: new Date(),
            });

            addedCount++;
          }

          if (addedCount > 0) {
            await participant.save();
            results.push({
              participantId: participant.participantId,
              name: participant.name,
              entitlementsAdded: addedCount,
            });
          }
        } catch (error) {
          errors.push(`${participant.participantId}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Auto-assignment completed. ${results.length} participants updated.`,
        results,
        errors,
      });
    } catch (error) {
      console.error("Auto-assign entitlements error:", error);
      res.status(500).json({
        success: false,
        message: "Error in auto-assigning entitlements",
      });
    }
  }
);

// Get participant's custom entitlements
router.get(
  "/participant/:participantId",
  authenticateToken,
  async (req, res) => {
    try {
      const { participantId } = req.params;

      const participant = await Participant.findOne({ participantId })
        .populate("customEntitlements.addedBy", "username")
        .populate("customEntitlements.givenBy", "username")
        .populate("customEntitlements.undoneBy", "username");

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      res.json({
        success: true,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          isPlayer: participant.isPlayer,
          customEntitlements: participant.customEntitlements,
        },
      });
    } catch (error) {
      console.error("Get participant entitlements error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching participant entitlements",
      });
    }
  }
);

module.exports = router;
