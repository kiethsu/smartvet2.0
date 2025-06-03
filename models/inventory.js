// models/inventory.js

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const InventorySchema = new Schema({
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: [
      "pet grooming",
      "pet accessories",
      "pet essentials",
      "pet medication",
      "pet vaccination",
      "heartworm preventive",
      "anti-thick and flea preventive",
      "injectable meds",
      "clinic needs",
      "surgery",
      "cbc",
      "blood chemistry",
      "gas anesthesia",
      "cbc/blood chemistry",
      "urinalysis",
      "ultrasounds",
      "blood collection",
      "syringe",
      "needle",
      "test kits",
      "petfood",
      "dewormer"
    ]
  },

  basePrice: {
    type: Number,
    required: true,
    min: 0
  },
  markup: {
    type: Number, 
    required: true,
    min: 0,
    default: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },

  expirationDates: [{
    type: Date
  }],

  // ← new: keep track of those that have already expired
  expiredDates: [{
    type: Date
  }],

  quantity: {
    type: Number,
    required: true,
    min: 0
  },

  // ← new: how many units have expired
  expiredCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

module.exports = mongoose.model("Inventory", InventorySchema);
