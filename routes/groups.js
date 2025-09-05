const express = require("express");
const Group = require("../models/Group");
const Participant = require("../models/Participant");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Get all groups
router.get("/", authenticateToken, async (req, res) => {
  try {
    const groups = await Group.find({ isActive: true })
      .populate("createdBy", "username")
      .populate("members.addedBy", "username")
      .sort({ name: 1 });

    // Get member details for each group
    const groupsWithMembers = await Promise.all(
      groups.map(async (group) => {
        const memberDetails = await Promise.all(
          group.members.map(async (member) => {
            const participant = await Participant.findOne({
              participantId: member.participantId,
            }).select("name email isPlayer foodPreference isPresent");
            return {
              ...member.toObject(),
              participant,
            };
          })
        );

        return {
          ...group.toObject(),
          members: memberDetails.filter((member) => member.participant), // Only include existing participants
        };
      })
    );

    res.json({
      success: true,
      groups: groupsWithMembers,
    });
  } catch (error) {
    console.error("Get groups error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching groups",
    });
  }
});

// Create new group
router.post(
  "/",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { name, description, color, groupType } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Group name is required",
        });
      }

      const existingGroup = await Group.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
        isActive: true,
      });

      if (existingGroup) {
        return res.status(400).json({
          success: false,
          message: "Group with this name already exists",
        });
      }

      const group = new Group({
        name,
        description,
        color: color || "#007AFF",
        groupType: groupType || "custom",
        members: [],
        createdBy: req.user.id,
      });

      await group.save();

      const populatedGroup = await Group.findById(group._id).populate(
        "createdBy",
        "username"
      );

      res.json({
        success: true,
        message: "Group created successfully",
        group: populatedGroup,
      });
    } catch (error) {
      console.error("Create group error:", error);
      res.status(500).json({
        success: false,
        message: "Error creating group",
      });
    }
  }
);

// Update group
router.put(
  "/:groupId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { name, description, color, groupType } = req.body;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
        });
      }

      // Check for duplicate name if name is being changed
      if (name && name !== group.name) {
        const existingGroup = await Group.findOne({
          name: { $regex: new RegExp(`^${name}$`, "i") },
          isActive: true,
          _id: { $ne: groupId },
        });

        if (existingGroup) {
          return res.status(400).json({
            success: false,
            message: "Group with this name already exists",
          });
        }
        group.name = name;
      }

      if (description !== undefined) group.description = description;
      if (color) group.color = color;
      if (groupType) group.groupType = groupType;

      await group.save();

      const populatedGroup = await Group.findById(group._id)
        .populate("createdBy", "username")
        .populate("members.addedBy", "username");

      res.json({
        success: true,
        message: "Group updated successfully",
        group: populatedGroup,
      });
    } catch (error) {
      console.error("Update group error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating group",
      });
    }
  }
);

// Delete group
router.delete(
  "/:groupId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
        });
      }

      group.isActive = false;
      await group.save();

      // Remove group references from participants
      await Participant.updateMany(
        { "groups.groupId": groupId },
        { $pull: { groups: { groupId } } }
      );

      res.json({
        success: true,
        message: "Group deleted successfully",
      });
    } catch (error) {
      console.error("Delete group error:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting group",
      });
    }
  }
);

// Add participants to group
router.post(
  "/:groupId/members",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { participantIds } = req.body;

      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "participantIds array is required",
        });
      }

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
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

          // Check if already in group
          const existingMember = group.members.find(
            (member) => member.participantId === participantId
          );

          if (existingMember) {
            errors.push(`${participantId}: Already in group`);
            continue;
          }

          // Add to group
          group.members.push({
            participantId,
            addedBy: req.user.id,
            addedAt: new Date(),
          });

          // Add group reference to participant
          participant.groups.push({
            groupId: group._id,
            groupName: group.name,
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

      await group.save();

      res.json({
        success: true,
        message: `Added ${results.length} participants to group "${group.name}"`,
        results,
        errors,
      });
    } catch (error) {
      console.error("Add group members error:", error);
      res.status(500).json({
        success: false,
        message: "Error adding participants to group",
      });
    }
  }
);

// Remove participant from group
router.delete(
  "/:groupId/members/:participantId",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { groupId, participantId } = req.params;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
        });
      }

      // Remove from group
      group.members = group.members.filter(
        (member) => member.participantId !== participantId
      );
      await group.save();

      // Remove group reference from participant
      await Participant.updateOne(
        { participantId },
        { $pull: { groups: { groupId } } }
      );

      res.json({
        success: true,
        message: "Participant removed from group",
      });
    } catch (error) {
      console.error("Remove group member error:", error);
      res.status(500).json({
        success: false,
        message: "Error removing participant from group",
      });
    }
  }
);

// Bulk distribute entitlements to group
router.post(
  "/:groupId/distribute",
  authenticateToken,
  requirePermission("canDistributeFood"),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { entitlementType, entitlementName, count = 1 } = req.body;

      if (
        !entitlementType ||
        (!entitlementName &&
          ![
            "breakfast",
            "lunch",
            "beer",
            "eveningMeal",
            "specialBeverage",
            "specialMeal",
          ].includes(entitlementType))
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid entitlementType or entitlementName is required",
        });
      }

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
        });
      }

      const results = [];
      const errors = [];
      const isCustomEntitlement =
        entitlementName &&
        ![
          "breakfast",
          "lunch",
          "beer",
          "eveningMeal",
          "specialBeverage",
          "specialMeal",
        ].includes(entitlementType);

      for (const member of group.members) {
        try {
          const participant = await Participant.findOne({
            participantId: member.participantId,
          });

          if (!participant) {
            errors.push(`${member.participantId}: Participant not found`);
            continue;
          }

          if (!participant.isPresent) {
            errors.push(`${member.participantId}: Not marked present`);
            continue;
          }

          let success = false;

          if (isCustomEntitlement) {
            // Handle custom entitlement
            const entitlement = participant.customEntitlements.find(
              (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
            );

            if (!entitlement) {
              errors.push(
                `${member.participantId}: Does not have "${entitlementName}" entitlement`
              );
              continue;
            }

            const requestedCount = parseInt(count);

            if (entitlement.isCountable) {
              if (entitlement.given + requestedCount > entitlement.maxCount) {
                errors.push(
                  `${member.participantId}: Limit exceeded for "${entitlementName}"`
                );
                continue;
              }

              entitlement.given += requestedCount;
              for (let i = 0; i < requestedCount; i++) {
                entitlement.givenAt.push(new Date());
                entitlement.givenBy.push(req.user.id);
              }
            } else {
              if (entitlement.given >= entitlement.maxCount) {
                errors.push(
                  `${member.participantId}: "${entitlementName}" already given`
                );
                continue;
              }

              entitlement.given = entitlement.maxCount;
              entitlement.givenAt.push(new Date());
              entitlement.givenBy.push(req.user.id);
            }

            success = true;
          } else {
            // Handle fixed entitlement
            if (!participant.entitlements[entitlementType]) {
              errors.push(
                `${member.participantId}: Not eligible for ${entitlementType}`
              );
              continue;
            }

            if (entitlementType === "beer") {
              const EventSettings = require("../models/EventSettings");
              const beerLimitSetting = await EventSettings.findOne({
                settingName: "beerLimit",
              });
              const beerLimit = beerLimitSetting
                ? beerLimitSetting.settingValue
                : 2;

              const currentCount = participant.entitlements.beer.given;
              const requestedCount = parseInt(count);

              if (currentCount + requestedCount > beerLimit) {
                errors.push(`${member.participantId}: Beer limit exceeded`);
                continue;
              }

              participant.entitlements.beer.given += requestedCount;
              for (let i = 0; i < requestedCount; i++) {
                participant.entitlements.beer.givenAt.push(new Date());
                participant.entitlements.beer.givenBy.push(req.user.id);
              }
            } else {
              if (participant.entitlements[entitlementType].given) {
                errors.push(
                  `${member.participantId}: ${entitlementType} already given`
                );
                continue;
              }

              participant.entitlements[entitlementType] = {
                given: true,
                givenAt: new Date(),
                givenBy: req.user.id,
              };
            }

            success = true;
          }

          if (success) {
            // Add to group entitlement history
            participant.groupEntitlementHistory.push({
              groupId: group._id,
              groupName: group.name,
              entitlementName: entitlementName || entitlementType,
              entitlementType: isCustomEntitlement ? "custom" : "fixed",
              count: parseInt(count),
              distributedBy: req.user.id,
              distributedAt: new Date(),
            });

            await participant.save();

            results.push({
              participantId: member.participantId,
              name: participant.name,
              success: true,
            });
          }
        } catch (error) {
          errors.push(`${member.participantId}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Group distribution completed. ${results.length} participants updated.`,
        group: {
          id: group._id,
          name: group.name,
        },
        entitlement: entitlementName || entitlementType,
        results,
        errors,
      });
    } catch (error) {
      console.error("Group distribute error:", error);
      res.status(500).json({
        success: false,
        message: "Error in group entitlement distribution",
      });
    }
  }
);

// Undo group entitlement distribution
router.delete(
  "/:groupId/undo",
  authenticateToken,
  requirePermission("canUndoActions"),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { entitlementType, entitlementName, count = 1 } = req.body;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({
          success: false,
          message: "Group not found",
        });
      }

      const results = [];
      const errors = [];
      const targetEntitlementName = entitlementName || entitlementType;
      const isCustomEntitlement =
        entitlementName &&
        ![
          "breakfast",
          "lunch",
          "beer",
          "eveningMeal",
          "specialBeverage",
          "specialMeal",
        ].includes(entitlementType);

      for (const member of group.members) {
        try {
          const participant = await Participant.findOne({
            participantId: member.participantId,
          });

          if (!participant) {
            errors.push(`${member.participantId}: Participant not found`);
            continue;
          }

          // Find the latest group distribution for this entitlement
          const groupDistribution = participant.groupEntitlementHistory
            .filter(
              (h) =>
                h.groupId.toString() === groupId &&
                h.entitlementName === targetEntitlementName &&
                !h.undoneAt
            )
            .sort((a, b) => b.distributedAt - a.distributedAt)[0];

          if (!groupDistribution) {
            errors.push(
              `${member.participantId}: No recent group distribution found for "${targetEntitlementName}"`
            );
            continue;
          }

          let success = false;

          if (isCustomEntitlement) {
            // Handle custom entitlement undo
            const entitlement = participant.customEntitlements.find(
              (ent) => ent.name.toLowerCase() === entitlementName.toLowerCase()
            );

            if (!entitlement || entitlement.given === 0) {
              errors.push(
                `${member.participantId}: No "${entitlementName}" to undo`
              );
              continue;
            }

            const undoCount = Math.min(
              parseInt(count),
              entitlement.given,
              groupDistribution.count
            );

            if (entitlement.isCountable) {
              entitlement.given -= undoCount;
              entitlement.givenAt.splice(-undoCount, undoCount);
              entitlement.givenBy.splice(-undoCount, undoCount);
            } else {
              entitlement.given = 0;
              entitlement.givenAt = [];
              entitlement.givenBy = [];
            }

            success = true;
          } else {
            // Handle fixed entitlement undo
            if (!participant.entitlements[entitlementType]) {
              errors.push(
                `${member.participantId}: No ${entitlementType} entitlement found`
              );
              continue;
            }

            if (entitlementType === "beer") {
              const currentCount = participant.entitlements.beer.given;
              if (currentCount === 0) {
                errors.push(`${member.participantId}: No beer to undo`);
                continue;
              }

              const undoCount = Math.min(
                parseInt(count),
                currentCount,
                groupDistribution.count
              );
              participant.entitlements.beer.given -= undoCount;
              participant.entitlements.beer.givenAt.splice(
                -undoCount,
                undoCount
              );
              participant.entitlements.beer.givenBy.splice(
                -undoCount,
                undoCount
              );
            } else {
              if (!participant.entitlements[entitlementType].given) {
                errors.push(
                  `${member.participantId}: ${entitlementType} not given`
                );
                continue;
              }

              participant.entitlements[entitlementType] = {
                given: false,
                givenAt: null,
                givenBy: null,
              };
            }

            success = true;
          }

          if (success) {
            // Mark group distribution as undone
            groupDistribution.undoneAt = new Date();
            groupDistribution.undoneBy = req.user.id;

            await participant.save();

            results.push({
              participantId: member.participantId,
              name: participant.name,
              success: true,
            });
          }
        } catch (error) {
          errors.push(`${member.participantId}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Group undo completed. ${results.length} participants updated.`,
        group: {
          id: group._id,
          name: group.name,
        },
        entitlement: targetEntitlementName,
        results,
        errors,
      });
    } catch (error) {
      console.error("Group undo error:", error);
      res.status(500).json({
        success: false,
        message: "Error in group entitlement undo",
      });
    }
  }
);

module.exports = router;
