// adminRoutes.js
const express = require("express");
const path = require("path");
const multer = require("multer");
const adminController = require("../controllers/adminController");
const DashboardSetting = require('../models/dashboardSetting');
const Joi = require('joi');
const Inventory = require("../models/inventory");
const router = express.Router();
const Service = require("../models/service");
const ServiceCategory = require("../models/serviceCategory");
const mongoose = require("mongoose");
const Payment = require('../models/Payment');


// Helper middleware for validating request bodies
function validateRequest(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    next();
  };
}

// Define schemas for input validation
const createAccountSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid("Doctor", "HR").required(),
});

const resetAccountSchema = Joi.object({
  userId: Joi.string().required(),
  newEmail: Joi.string().email().optional().allow(''),
  newPassword: Joi.string().min(8).optional().allow(''),
});

const deleteAccountSchema = Joi.object({
  userId: Joi.string().required()
});

const updateOtpSettingSchema = Joi.object({
  userId: Joi.string().required(),
  otpEnabled: Joi.boolean().required()
});

// Configure Multer storage for profile image uploads.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Make sure "public/uploads" folder exists
    cb(null, path.join(__dirname, "../public/uploads"));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, "profile-" + Date.now() + ext);
  }
});
const upload = multer({ storage });

// -------------------- Admin API Endpoints --------------------

// Create Account route with input validation
router.post(
  "/create-account",
  validateRequest(createAccountSchema),
  adminController.createAccount
);

// Get accounts, reset account, delete account
router.get("/api/accounts", adminController.getAccounts);
router.put("/reset-account", validateRequest(resetAccountSchema), adminController.resetAccount);
router.delete("/delete-account", validateRequest(deleteAccountSchema), adminController.deleteAccount);
router.get("/profile/:userId", adminController.getAccountProfile);

// Update OTP Verification Setting for Admin
router.post(
  "/update-otp-setting",
  validateRequest(updateOtpSettingSchema),
  adminController.updateOTPSetting
);

// -------------------- Admin View Routes --------------------
router.get("/dashboard", (req, res) => {
  res.render("dashboard");
});
router.get("/accounts-view", (req, res) => {
  res.render("accounts");
});
// In adminRoutes.js, update the profile view route:
router.get("/profile", async (req, res) => {
  try {
    // For example, if the admin's email is known:
    const adminUser = await require("../models/user").findOne({ email: "smartvetclinic17@gmail.com" }).lean();
    if (!adminUser) {
      return res.status(404).send("Admin user not found.");
    }
    res.render("profile", { user: adminUser });
  } catch (error) {
    console.error("Error fetching admin profile:", error);
    res.status(500).send("Server error");
  }
});

// Admin pet list view route
router.get("/petlist", (req, res) => {
  // You may need to query for pets here, similar to HR:
  const Pet = require("../models/pet");
  Pet.find().populate('owner', 'username').lean()
    .then(pets => {
      res.render("petlist", { pets });
    })
    .catch(err => {
      console.error("Error fetching pet list:", err);
      res.status(500).send("Server error");
    });
});
router.get("/generate-report", adminController.generateReport);
router.get("/peak-day-of-week", adminController.getPeakDayOfWeek);

router.get("/predict-appointments", adminController.predictAppointments);
router.post("/update-profile", upload.single("profilePic"), adminController.updateProfile);
router.get("/get-dashboard-stats", adminController.getDashboardStats);
// Render the Inventory view
router.get("/inventory", (req, res) => {
  res.render("inventory"); // Ensure views/inventory.ejs exists.
});

// API route to list all inventory items
router.get("/inventory/list", async (req, res) => {
  try {
    const items = await Inventory.find().lean();
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Error fetching inventory items" });
  }
});

// API route to add a new inventory item
// API route to add a new inventory item
router.post("/inventory/add", async (req, res) => {
  try {
    const { name, category, price, quantity } = req.body;
    let expirationDates = req.body["expirationDates[]"] || req.body.expirationDates;
    if (expirationDates) {
      if (!Array.isArray(expirationDates)) {
        expirationDates = [expirationDates];
      }
      expirationDates = expirationDates.filter(date => date);
    } else {
      expirationDates = [];
    }
    const newItem = new Inventory({
      name,
      category,
      price,
      quantity,
      expirationDates
    });
    await newItem.save();
    res.json({ message: "Inventory item added successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error adding inventory item" });
  }
});


// API route to fetch a single inventory item by ID
router.get("/inventory/item/:id", async (req, res) => {
  try {
    const item = await Inventory.findById(req.params.id).lean();
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error fetching inventory item" });
  }
});

// API route to edit an inventory item
router.post("/inventory/edit", async (req, res) => {
  try {
    const { id, name, category, price, quantity } = req.body;
    let expirationDates = req.body["expirationDates[]"] || req.body.expirationDates;
    if (expirationDates) {
      if (!Array.isArray(expirationDates)) {
        expirationDates = [expirationDates];
      }
      expirationDates = expirationDates.filter(date => date);
    } else {
      expirationDates = [];
    }
    await Inventory.findByIdAndUpdate(id, { name, category, price, quantity, expirationDates });
    res.json({ message: "Inventory item updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating inventory item" });
  }
});

// API route to delete an inventory item
router.post("/inventory/delete", async (req, res) => {
  try {
    const { id } = req.body;
    await Inventory.findByIdAndDelete(id);
    res.json({ message: "Inventory item deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting inventory item" });
  }
});

// -------------------- Service Category Routes --------------------
router.get("/services/categories/list", async (req, res) => {
  try {
    const categories = await ServiceCategory.find().lean();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching categories" });
  }
});
router.post("/services/categories/add", async (req, res) => {
  try {
    const { name } = req.body;
    const newCategory = new ServiceCategory({ name });
    await newCategory.save();
    res.json({ message: "Category added successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error adding category" });
  }
});
router.post("/services/categories/delete", async (req, res) => {
  try {
    await ServiceCategory.findByIdAndDelete(req.body.id);
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting category" });
  }
});

// -------------------- Service Item Routes --------------------
// Render the Services view
router.get("/services", (req, res) => {
  res.render("services"); // Ensure views/services.ejs exists.
});
router.get("/services/list", async (req, res) => {
  try {
    const services = await Service.find().lean();
    for (let svc of services) {
      if (mongoose.Types.ObjectId.isValid(svc.category)) {
        const cat = await ServiceCategory.findById(svc.category).lean();
        svc.categoryName = cat ? cat.name : "Unknown";
      } else {
        svc.categoryName = "Invalid Category";
      }
    }
    res.json(services);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ message: "Error fetching services", error: error.message });
  }
});
router.post("/services/add", async (req, res) => {
  try {
    const { category, serviceName, weight, dosage, price } = req.body;
    const newService = new Service({ category, serviceName, weight, dosage, price });
    await newService.save();
    res.json({ message: "Service added successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error adding service" });
  }
});
router.get("/services/item/:id", async (req, res) => {
  try {
    const service = await Service.findById(req.params.id).lean();
    res.json(service);
  } catch (error) {
    res.status(500).json({ message: "Error fetching service item" });
  }
});
router.post("/services/edit", async (req, res) => {
  try {
    const { id, category, serviceName, weight, dosage, price } = req.body;
    await Service.findByIdAndUpdate(id, { category, serviceName, weight, dosage, price });
    res.json({ message: "Service updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating service" });
  }
});
router.post("/services/delete", async (req, res) => {
  try {
    await Service.findByIdAndDelete(req.body.id);
    res.json({ message: "Service deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting service" });
  }
});
router.get('/inventory-stats', adminController.getInventoryStats);
// in adminRoutes.js, after router.get("/inventory", ...)
router.get("/sales-report", (req, res) => {
  // If you have logic to gather data, do it here and pass to the template.
  res.render("sales-report"); 
});
router.get("/download-sales-report.xlsx", adminController.downloadSalesExcel);
router.get("/download-sales-report.csv",  adminController.downloadSalesCSV);
router.get("/download-sales-report.pdf",  adminController.downloadSalesPDF);
module.exports = router;
